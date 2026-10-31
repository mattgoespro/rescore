import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { RatingsStore } from "../services/ratings-store.js";
import { CatalogDatabase } from "./database.js";

function seed(): CatalogDatabase {
  const db = new CatalogDatabase(":memory:");
  const titles = [
    { id: "tt1", year: 2015, genre: "Action", rating: 7, votes: 900_000 },
    // Rated by the user, so it names the director and stays out.
    { id: "tt10", year: 1994, genre: "Drama", rating: 9, votes: 6_000 },
    { id: "tt11", year: 1996, genre: "Drama", rating: 8.5, votes: 8_000 },
    { id: "tt12", year: 2010, genre: "Comedy", rating: 6, votes: 1_500 },
    { id: "tt14", year: 1950, genre: "Drama", rating: 9.5, votes: 9_000 },
  ];
  db.upsertTitles(
    titles.map((title) => ({
      id: title.id,
      title: `Title ${title.id}`,
      kind: "movie",
      year: title.year,
      genres: [title.genre],
      directors:
        title.id === "tt10" || title.id === "tt12" ? ["Ann Lee"] : ["Other"],
    })),
  );
  db.upsertRatings(
    new Map(
      titles.map((title) => [
        title.id,
        { rating: title.rating, votes: title.votes },
      ]),
    ),
  );
  db.saveLibrary("tt10", "watched", 9, null);
  return db;
}

const ids = (
  db: CatalogDatabase,
  hints?: Parameters<CatalogDatabase["listForYouCandidates"]>[1],
) => db.listForYouCandidates(1, hints).map((title) => title.id);

test("For You candidates are the most-voted titles without hints", () => {
  const db = seed();
  try {
    assert.deepEqual(ids(db), ["tt1"]);
  } finally {
    db.close();
  }
});

test("liked genres, decades and directors add titles past the most-voted", () => {
  const db = seed();
  try {
    assert.deepEqual(
      ids(db, { genres: ["Drama"], decades: [1990], directors: ["Ann Lee"] }),
      // Popular first, then the best-rated 1990s drama not yet watched, then
      // the director's other work, which sits below the general vote floor.
      ["tt1", "tt11", "tt12"],
    );
  } finally {
    db.close();
  }
});

test("a director the library never credited adds nothing", () => {
  const db = seed();
  try {
    assert.deepEqual(ids(db, { directors: ["Nobody Known"] }), ["tt1"]);
  } finally {
    db.close();
  }
});

test("/v1/for-you reads repeated hints and keeps commas in director names", async () => {
  const db = seed();
  db.upsertTitles([
    {
      id: "tt20",
      title: "Comma credit",
      kind: "movie",
      year: 1980,
      genres: ["Western"],
      directors: ["Lee, Ann"],
    },
    {
      id: "tt21",
      title: "Comma credit, again",
      kind: "movie",
      year: 1982,
      genres: ["Western"],
      directors: ["Lee, Ann"],
    },
  ]);
  db.upsertRatings(
    new Map([
      ["tt20", { rating: 8, votes: 2_000 }],
      ["tt21", { rating: 7, votes: 3_000 }],
    ]),
  );
  db.saveLibrary("tt20", "watched", 9, null);
  const server = createApp(new RatingsStore(db), db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const url = new URL("/v1/for-you", base);
    url.searchParams.set("limit", "1");
    url.searchParams.append("director", "Lee, Ann");
    url.searchParams.append("director", "Ann Lee");
    const body = (await (await fetch(url)).json()) as {
      candidates: Array<{ id: string }>;
    };
    assert.deepEqual(
      body.candidates.map((title) => title.id),
      ["tt1", "tt21"],
    );
    const rejected = await fetch(`${base}/v1/for-you?decade=1995`);
    assert.equal(rejected.status, 400);
  } finally {
    server.close();
    db.close();
  }
});
