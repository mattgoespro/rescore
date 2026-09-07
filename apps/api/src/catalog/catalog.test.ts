import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CatalogDatabase } from "./database.js";
import { bayesianScore } from "./bayesian.js";

const dirs: string[] = [];

function openCatalog(): CatalogDatabase {
  const dir = mkdtempSync(join(tmpdir(), "imdbrain-catalog-"));
  dirs.push(dir);
  return new CatalogDatabase(join(dir, "catalog.sqlite"));
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seedTitle(
  catalog: CatalogDatabase,
  row: {
    id: string;
    title: string;
    rating: number;
    votes: number;
    genres?: string[];
  },
): void {
  catalog.insertTitleRows([
    {
      id: row.id,
      title: row.title,
      originalTitle: row.title,
      kind: "movie",
      year: 1999,
      runtimeMinutes: 120,
      imdbRating: row.rating,
      imdbVotes: row.votes,
      genres: row.genres ?? ["Action"],
    },
  ]);
}

test("titles are ready without credits", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0133093", title: "The Matrix", rating: 8.7, votes: 2_000_000 });
  catalog.setCatalogMeta({
    builtAt: new Date().toISOString(),
    revision: "test",
    source: "test",
  });
  assert.equal(catalog.titlesReady(), true);
  assert.equal(catalog.creditsReady(), false);
  catalog.close();
});

test("batch hydrate attaches genres and people", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 2_000_000,
    genres: ["Action", "Sci-Fi"],
  });
  catalog.insertPeople([
    { titleId: "tt0133093", name: "Lana Wachowski", role: "director", position: 0 },
    { titleId: "tt0133093", name: "Keanu Reeves", role: "cast", position: 0 },
  ]);
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
  });
  assert.equal(page.data.length, 1);
  assert.deepEqual(page.data[0]?.genres, ["Action", "Sci-Fi"]);
  assert.deepEqual(page.data[0]?.directors, ["Lana Wachowski"]);
  assert.deepEqual(page.data[0]?.cast, ["Keanu Reeves"]);
  catalog.close();
});

test("rating sort uses persisted bayesian score", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "Obscure Ten", rating: 10, votes: 12 });
  seedTitle(catalog, { id: "tt0000002", title: "Popular Nine", rating: 9, votes: 500_000 });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "rating",
    order: "desc",
  });
  assert.equal(page.data[0]?.id, "tt0000002");
  assert.ok(
    bayesianScore(9, 500_000) > bayesianScore(10, 12),
  );
  catalog.close();
});

test("FTS prefix search finds titles", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0133093", title: "The Matrix", rating: 8.7, votes: 1000 });
  seedTitle(catalog, { id: "tt0000002", title: "Unrelated", rating: 7, votes: 1000 });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    query: "matr",
  });
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0]?.id, "tt0133093");
  catalog.close();
});

test("exact IMDb id search does not use FTS", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0133093", title: "The Matrix", rating: 8.7, votes: 1000 });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    query: "tt0133093",
  });
  assert.equal(page.data[0]?.id, "tt0133093");
  catalog.close();
});

test("includeTotal false still pages when the page is full", () => {
  const catalog = openCatalog();
  for (let index = 1; index <= 3; index += 1) {
    seedTitle(catalog, {
      id: `tt000000${index}`,
      title: `Title ${index}`,
      rating: 7,
      votes: 1000 + index,
    });
  }
  const first = catalog.listTitles({
    page: 1,
    pageSize: 2,
    sort: "title",
    order: "asc",
    includeTotal: true,
  });
  assert.equal(first.pagination.total, 3);
  const next = catalog.listTitles({
    page: 2,
    pageSize: 2,
    sort: "title",
    order: "asc",
    includeTotal: false,
  });
  assert.ok(next.pagination.total >= 3);
  catalog.close();
});

test("for-you candidates exclude watched and skipped", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "Watched", rating: 8, votes: 10_000 });
  seedTitle(catalog, { id: "tt0000002", title: "Open", rating: 8, votes: 9_000 });
  catalog.setCatalogMeta({
    builtAt: new Date().toISOString(),
    revision: "test",
    source: "test",
  });
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  const candidates = catalog.listForYouCandidates(50);
  assert.equal(candidates.some((title) => title.id === "tt0000001"), false);
  assert.equal(candidates.some((title) => title.id === "tt0000002"), true);
  catalog.close();
});
