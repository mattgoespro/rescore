import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogDatabase } from "./database.js";
import type { TitleQuery } from "./types.js";

const query: TitleQuery = {
  page: 1,
  pageSize: 40,
  sort: "title",
  order: "asc",
};

test("query caches isolate interleaved catalogue connections and mutations", () => {
  const a = new CatalogDatabase(":memory:");
  const b = new CatalogDatabase(":memory:");
  try {
    a.upsertTitles([{ id: "tt1", title: "A", genres: ["Drama"] }]);
    b.upsertTitles([
      { id: "tt2", title: "B", genres: ["Comedy"] },
      { id: "tt3", title: "C", genres: ["Comedy"] },
    ]);
    assert.deepEqual(a.facets().genres, [{ value: "Drama", count: 1 }]);
    assert.deepEqual(b.facets().genres, [{ value: "Comedy", count: 2 }]);
    assert.equal(a.listTitles(query).pagination.total, 1);
    assert.equal(b.listTitles(query).pagination.total, 2);
    a.upsertTitles([{ id: "tt4", title: "D", genres: ["Drama"] }]);
    assert.equal(a.listTitles(query).pagination.total, 2);
    assert.equal(b.listTitles(query).pagination.total, 2);
    assert.deepEqual(b.facets().genres, [{ value: "Comedy", count: 2 }]);
  } finally {
    a.close();
    b.close();
  }
});

test("language hydration invalidates cached language-filtered totals", () => {
  const db = new CatalogDatabase(":memory:");
  try {
    db.upsertTitles([{ id: "tt1", title: "A" }]);
    const filtered = { ...query, withoutLanguages: ["en"] };
    assert.equal(db.listTitles(filtered).pagination.total, 1);
    db.updatePosterUrls([{ id: "tt1", languages: ["en"] }]);
    assert.equal(db.listTitles(filtered).pagination.total, 0);
  } finally {
    db.close();
  }
});

test("aborted nonbulk title ingest exposes retained changes in facets", () => {
  const db = new CatalogDatabase(":memory:");
  try {
    db.upsertTitles([{ id: "tt1", title: "A", genres: ["Action"] }]);
    db.facets();
    db.startTitleIngest();
    db.upsertTitleRows([
      {
        id: "tt1",
        title: "A",
        originalTitle: "A",
        kind: "movie",
        year: 2000,
        runtimeMinutes: 100,
        imdbRating: 8,
        imdbVotes: 10,
        genres: ["Drama"],
      },
    ]);
    db.abortTitleIngest();
    assert.deepEqual(db.facets().genres, [{ value: "Drama", count: 1 }]);
  } finally {
    db.close();
  }
});
