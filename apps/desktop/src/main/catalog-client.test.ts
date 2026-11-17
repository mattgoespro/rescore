import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogClient } from "./catalog-client";
import { noteSystemResume } from "./catalog-connection";
import { movieFromTitle } from "../shared/movie";

test("watched writes omit absent scores and pass imported dates through to the API", async () => {
  const fetch = globalThis.fetch;
  const sent: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
  try {
    const movie = movieFromTitle({
      id: "tt100",
      title: "Fixture",
      originalTitle: null,
      kind: "movie",
      year: 2000,
      runtimeMinutes: 100,
      synopsis: null,
      posterUrl: null,
      certification: null,
      imdbRating: 8,
      imdbVotes: 1000,
      genres: [],
      directors: [],
      cast: [],
    });
    const client = new CatalogClient("http://127.0.0.1:3847");
    await client.saveLibrary(movie, "watched");
    await client.saveLibrary(movie, "watched", 8, "2012-04-05T00:00:00.000Z");
    assert.deepEqual(sent, [
      { status: "watched" },
      {
        status: "watched",
        personalRating: 8,
        ratedAt: "2012-04-05T00:00:00.000Z",
      },
    ]);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("library writes send again after a dropped connection, and a repeated delete is not an error", async () => {
  const fetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method} ${new URL(String(input)).pathname}`);
    if (calls.length === 1) throw new TypeError("fetch failed");
    if (init?.method === "DELETE")
      return new Response('{"error":"Not found"}', { status: 404 });
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new CatalogClient("http://127.0.0.1:3847");
    await client.saveLibrary(
      movieFromTitle({
        id: "tt100",
        title: "Fixture",
        originalTitle: null,
        kind: "movie",
        year: 2000,
        runtimeMinutes: 100,
        synopsis: null,
        posterUrl: null,
        certification: null,
        imdbRating: 8,
        imdbVotes: 1000,
        genres: [],
        directors: [],
        cast: [],
      }),
      "skipped",
    );
    await client.removeLibrary("tt100");
    assert.deepEqual(calls, [
      "PUT /v1/library/tt100",
      "PUT /v1/library/tt100",
      "DELETE /v1/library/tt100",
    ]);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("a call that hits the deadlock guard fails once, naming the request, and is not sent again", async () => {
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  try {
    const client = new CatalogClient("http://127.0.0.1:3847");
    await assert.rejects(
      client.listLibrary(),
      /did not answer \/v1\/library within 30 seconds/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = fetch;
  }
});

test("a call whose timeout fired across a sleep of the computer is sent again", async () => {
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      noteSystemResume();
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return new Response('{"data":[]}', { status: 200 });
  };
  try {
    const client = new CatalogClient("http://127.0.0.1:3847");
    assert.deepEqual(await client.listLibrary(), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = fetch;
  }
});
