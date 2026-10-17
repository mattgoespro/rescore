import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogClient } from "./catalog-client";
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
