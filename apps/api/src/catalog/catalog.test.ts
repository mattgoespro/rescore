import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";
import { createApp } from "../app.js";
import { ingestTitles } from "../build/import-basics.js";
import { RatingsStore } from "../services/ratings-store.js";
import { bayesianScore } from "./bayesian.js";
import { CatalogDatabase } from "./database.js";
import Database from "better-sqlite3";
import { FTS_SET_THRESHOLD, libraryListSql } from "./query.js";
import { migrations } from "./schema.js";

const dirs: string[] = [];

test("title DTO retains pending versus confirmed absent poster metadata", () => {
  const catalog = openCatalog();
  try {
    for (const [id, posterUrl] of [
      ["tt1", null],
      ["tt2", ""],
      ["tt3", "https://image.tmdb.org/t/p/w500/poster.jpg"],
    ] as const) {
      catalog.upsertTitles([{ id, title: id, kind: "movie", posterUrl }]);
    }
    assert.equal(catalog.title("tt1")?.posterStatus, "pending");
    assert.equal(catalog.title("tt2")?.posterStatus, "unavailable");
    assert.equal(catalog.title("tt3")?.posterStatus, "available");
  } finally {
    catalog.close();
  }
});

function openCatalog(): CatalogDatabase {
  const dir = mkdtempSync(join(tmpdir(), "rescore-catalog-"));
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

function writeGzipTsv(dir: string, name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, gzipSync(Buffer.from(`${lines.join("\n")}\n`)));
  return path;
}

test("reconciliation retains saved titles missing from IMDb and refuses empty input", async () => {
  const catalog = openCatalog();
  try {
    for (const id of ["tt100", "tt200", "tt300"])
      seedTitle(catalog, { id, title: id, rating: 8, votes: 1000 });
    catalog.saveLibrary("tt100", "watched", 9, "keep my rating");
    const file = writeGzipTsv(dirs.at(-1)!, "changed.gz", [
      "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
      "tt200\tmovie\tSurvivor\tSurvivor\t0\t2000\t\\N\t100\tDrama",
    ]);
    await ingestTitles(
      catalog,
      file,
      new Map([["tt200", { rating: 8, votes: 1000 }]]),
    );
    assert.equal(catalog.title("tt300"), null);
    assert.equal(catalog.listLibrary()[0].personalRating, 9);
    assert.equal(catalog.listLibrary()[0].note, "keep my rating");
    const empty = writeGzipTsv(dirs.at(-1)!, "empty.gz", ["tconst\ttitleType"]);
    await assert.rejects(
      ingestTitles(catalog, empty, new Map()),
      /unexpectedly few/,
    );
    assert.equal(catalog.titleCount(), 2);
    const corrupt = join(dirs.at(-1)!, "corrupt.gz");
    const compressed = gzipSync("tconst\ttitleType\ninvalid");
    writeFileSync(corrupt, compressed.subarray(0, compressed.length - 6));
    await assert.rejects(ingestTitles(catalog, corrupt, new Map()));
    assert.equal(catalog.titleCount(), 2);
  } finally {
    catalog.close();
  }
});

test("library dates survive reads, status changes, deletion Undo, and reopening", () => {
  const catalog = openCatalog();
  const path = join(dirs.at(-1)!, "catalog.sqlite");
  seedTitle(catalog, { id: "tt100", title: "Dated", rating: 8, votes: 1000 });
  const raw = new Database(path);
  raw
    .prepare("UPDATE titles SET updated_at=? WHERE id=?")
    .run("2001-01-01T00:00:00.000Z", "tt100");
  raw.close();
  const date = "2012-04-05T00:00:00.000Z";
  const saved = catalog.saveLibrary("tt100", "watched", 8, null, date)!;
  assert.equal(catalog.listLibrary()[0].updatedAt, saved.updatedAt);
  assert.equal(catalog.listLibrary()[0].ratedAt, date);
  catalog.saveLibrary("tt100", "watchlist", undefined, null);
  assert.equal(catalog.listLibrary()[0].personalRating, 8);
  assert.equal(catalog.listLibrary()[0].ratedAt, date);
  const removed = catalog.deleteLibrary("tt100")!;
  catalog.saveLibrary(
    "tt100",
    removed.status,
    removed.personalRating,
    removed.note,
    removed.ratedAt ?? undefined,
  );
  catalog.close();
  const reopened = new CatalogDatabase(path);
  try {
    assert.equal(reopened.listLibrary()[0].ratedAt, date);
  } finally {
    reopened.close();
  }
});

test("an unexpectedly small rebuild cannot remove most of a populated catalogue", async () => {
  const catalog = openCatalog();
  try {
    catalog.insertTitleRows(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `tt${index}`,
        title: "Existing",
        originalTitle: null,
        kind: "movie",
        year: 2000,
        runtimeMinutes: 100,
        imdbRating: 8,
        imdbVotes: 1000,
        genres: [],
      })),
    );
    const file = writeGzipTsv(dirs.at(-1)!, "small.gz", [
      "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
      "tt0\tmovie\tExisting\tExisting\t0\t2000\t\\N\t100\tDrama",
    ]);
    await assert.rejects(
      ingestTitles(
        catalog,
        file,
        new Map([["tt0", { rating: 8, votes: 1000 }]]),
      ),
      /unexpectedly few/,
    );
    assert.equal(catalog.titleCount(), 1000);
  } finally {
    catalog.close();
  }
});

test("HTTP library saves support unscored watched titles and all genre exclusions", async () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt100",
    title: "Unscored",
    rating: 8,
    votes: 1000,
  });
  const server = createApp(new RatingsStore(catalog), catalog).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const saved = await fetch(`${base}/v1/library/tt100`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "watched" }),
    });
    assert.equal(saved.status, 200);
    assert.equal(catalog.listLibrary()[0].personalRating, null);
    const invalid = await fetch(`${base}/v1/library/tt100`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "watched", ratedAt: "yesterday" }),
    });
    assert.equal(invalid.status, 400);
    const genres = [
      "Action",
      "Adventure",
      "Animation",
      "Biography",
      "Comedy",
      "Crime",
      "Documentary",
      "Drama",
      "Family",
      "Fantasy",
    ];
    assert.equal(
      (await fetch(`${base}/v1/titles?withoutGenre=${genres.join(",")}`))
        .status,
      200,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    catalog.close();
  }
});

test("title ingest reconciles without wiping survivors", async () => {
  const catalog = openCatalog();
  const dir = dirs.at(-1)!;
  const header =
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres";
  const first = writeGzipTsv(dir, "basics-a.tsv.gz", [
    header,
    "tt0000001\tmovie\tKeep\tKeep\t0\t1999\t\\N\t120\tAction",
    "tt0000002\tmovie\tDrop Me\tDrop Me\t0\t1999\t\\N\t90\tDrama",
  ]);
  await ingestTitles(
    catalog,
    first,
    new Map([
      ["tt0000001", { rating: 8, votes: 100 }],
      ["tt0000002", { rating: 7, votes: 80 }],
    ]),
  );
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://image.tmdb.org/t/p/w342/keep.jpg",
      synopsis: "Kept",
    },
  ]);
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  const rowid = catalog.titleRowid("tt0000001");
  const second = writeGzipTsv(dir, "basics-b.tsv.gz", [
    header,
    "tt0000001\tmovie\tKeep Renamed\tKeep Renamed\t0\t2001\t\\N\t121\tAction,Sci-Fi",
    "tt0000003\tmovie\tNew One\tNew One\t0\t2000\t\\N\t100\tComedy",
  ]);
  await ingestTitles(
    catalog,
    second,
    new Map([
      ["tt0000001", { rating: 8.2, votes: 150 }],
      ["tt0000003", { rating: 6, votes: 50 }],
    ]),
  );
  assert.equal(catalog.title("tt0000002"), null);
  const kept = catalog.title("tt0000001");
  assert.equal(kept?.title, "Keep Renamed");
  assert.equal(kept?.year, 2001);
  assert.equal(kept?.posterUrl, "https://image.tmdb.org/t/p/w342/keep.jpg");
  assert.deepEqual(kept?.genres, ["Action", "Sci-Fi"]);
  assert.equal(catalog.titleRowid("tt0000001"), rowid);
  assert.equal(catalog.listLibrary()[0]?.title.id, "tt0000001");
  assert.equal(catalog.title("tt0000003")?.title, "New One");
  catalog.close();
});

test("bulk load rebuilds FTS after inserts", () => {
  const catalog = openCatalog();
  catalog.beginBulkLoad();
  for (let index = 1; index <= 120; index += 1) {
    seedTitle(catalog, {
      id: `tt${String(index).padStart(7, "0")}`,
      title: index === 13 ? "The Matrix" : `Title ${index}`,
      rating: 7,
      votes: 1000,
    });
  }
  catalog.endBulkLoad();
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    query: "matr",
  });
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0]?.id, "tt0000013");
  catalog.close();
});

function genreIds(
  catalog: CatalogDatabase,
  filter: { genres?: string[]; withoutGenres?: string[] },
): string[] {
  return catalog
    .listTitles({
      page: 1,
      pageSize: 100,
      sort: "votes",
      order: "desc",
      kind: "movie",
      includeTotal: false,
      ...filter,
    })
    .data.map((title) => title.id)
    .sort();
}

test("genre filters match stored genres for any-of and exclusion", () => {
  const catalog = openCatalog();
  const sets = [["Action"], ["Drama"], ["Action", "Drama"], ["Horror"], []];
  for (let index = 0; index < 15; index += 1) {
    seedTitle(catalog, {
      id: `tt${String(index + 1).padStart(7, "0")}`,
      title: `Title ${index}`,
      rating: 7,
      votes: 100 + index,
      genres: sets[index % sets.length]!,
    });
  }
  const all = catalog.listTitles({
    page: 1,
    pageSize: 100,
    sort: "votes",
    order: "desc",
  }).data;
  const expect = (keep: (genres: string[]) => boolean) =>
    all
      .filter((title) => keep(title.genres))
      .map((title) => title.id)
      .sort();
  assert.deepEqual(
    genreIds(catalog, { genres: ["Drama", "Horror"] }),
    expect((g) => g.includes("Drama") || g.includes("Horror")),
  );
  assert.deepEqual(
    genreIds(catalog, { withoutGenres: ["Action"] }),
    expect((g) => !g.includes("Action")),
  );
  assert.deepEqual(
    genreIds(catalog, { genres: ["Action"], withoutGenres: ["Drama"] }),
    expect((g) => g.includes("Action") && !g.includes("Drama")),
  );
  assert.deepEqual(genreIds(catalog, { genres: ["Musical"] }), []);
  assert.deepEqual(
    genreIds(catalog, { withoutGenres: ["Musical"] }),
    expect(() => true),
  );
  catalog.close();
});

test("genre filters follow a reingest that changes genres", async () => {
  const catalog = openCatalog();
  const dir = dirs.at(-1)!;
  const header =
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres";
  const ratings = new Map([
    ["tt0000001", { rating: 8, votes: 100 }],
    ["tt0000002", { rating: 7, votes: 80 }],
  ]);
  await ingestTitles(
    catalog,
    writeGzipTsv(dir, "basics-a.tsv.gz", [
      header,
      "tt0000001\tmovie\tOne\tOne\t0\t1999\t\\N\t120\tAction",
      "tt0000002\tmovie\tTwo\tTwo\t0\t1999\t\\N\t90\tDrama",
    ]),
    ratings,
  );
  assert.deepEqual(genreIds(catalog, { genres: ["Action"] }), ["tt0000001"]);
  await ingestTitles(
    catalog,
    writeGzipTsv(dir, "basics-b.tsv.gz", [
      header,
      "tt0000001\tmovie\tOne\tOne\t0\t1999\t\\N\t120\tSci-Fi",
      "tt0000002\tmovie\tTwo\tTwo\t0\t1999\t\\N\t90\tAction,Drama",
    ]),
    ratings,
  );
  assert.deepEqual(genreIds(catalog, { genres: ["Action"] }), ["tt0000002"]);
  assert.deepEqual(genreIds(catalog, { genres: ["Sci-Fi"] }), ["tt0000001"]);
  assert.deepEqual(genreIds(catalog, { withoutGenres: ["Drama"] }), [
    "tt0000001",
  ]);
  catalog.close();
});

test("bulk load rebuilds genre masks", () => {
  const catalog = openCatalog();
  catalog.beginBulkLoad();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "A",
    rating: 7,
    votes: 10,
    genres: ["Western"],
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "B",
    rating: 7,
    votes: 20,
    genres: ["Comedy"],
  });
  catalog.endBulkLoad();
  assert.deepEqual(genreIds(catalog, { genres: ["Western"] }), ["tt0000001"]);
  assert.deepEqual(genreIds(catalog, { withoutGenres: ["Western"] }), [
    "tt0000002",
  ]);
  catalog.close();
});

test("a stored genre without a mask bit still filters through title_genres", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "A",
    rating: 7,
    votes: 10,
    genres: ["Horror"],
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "B",
    rating: 7,
    votes: 20,
    genres: ["Comedy"],
  });
  const raw = new Database(join(dirs.at(-1)!, "catalog.sqlite"));
  raw.prepare("DELETE FROM genre_bits WHERE genre = 'Horror'").run();
  raw.close();
  assert.deepEqual(genreIds(catalog, { genres: ["Horror"] }), ["tt0000001"]);
  assert.deepEqual(genreIds(catalog, { withoutGenres: ["Horror"] }), [
    "tt0000002",
  ]);
  catalog.close();
});

test("library reads drive from library rows even with stale statistics", () => {
  const catalog = openCatalog();
  for (let index = 1; index <= 50; index += 1) {
    seedTitle(catalog, {
      id: `tt${String(index).padStart(7, "0")}`,
      title: `Title ${index}`,
      rating: 7,
      votes: index,
    });
  }
  const path = join(dirs.at(-1)!, "catalog.sqlite");
  const raw = new Database(path);
  raw.exec("ANALYZE");
  catalog.saveLibrary("tt0000007", "watched", 8, null);
  catalog.saveLibrary("tt0000003", "watchlist", null, null);
  for (const status of [undefined, "watched"] as const) {
    const plan = (
      raw
        .prepare(`EXPLAIN QUERY PLAN ${libraryListSql(status)}`)
        .all(...(status ? [status] : [])) as Array<{ detail: string }>
    ).map((row) => row.detail);
    assert.match(plan[0] ?? "", /^SCAN l\b/, status ?? "all");
  }
  raw.close();
  assert.deepEqual(
    catalog
      .listLibrary()
      .map((entry) => entry.title.id)
      .sort(),
    ["tt0000003", "tt0000007"],
  );
  catalog.close();
});

test("importBasics keeps rated movies from the in-memory ratings map", async () => {
  const catalog = openCatalog();
  const dir = dirs.at(-1)!;
  const basics = writeGzipTsv(dir, "title.basics.tsv.gz", [
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
    "tt0000001\tmovie\tKeep Me\tKeep Me\t0\t1999\t\\N\t120\tAction",
    "tt0000002\tmovie\tNo Rating\tNo Rating\t0\t1999\t\\N\t90\tDrama",
    "tt0000003\tshort\tSkip Short\tSkip Short\t0\t1999\t\\N\t10\tAction",
  ]);
  await ingestTitles(
    catalog,
    basics,
    new Map([["tt0000001", { rating: 8, votes: 100 }]]),
  );
  assert.equal(catalog.titleCount(), 1);
  assert.equal(catalog.title("tt0000001")?.title, "Keep Me");
  catalog.close();
});

test("unchanged ratings do not update title rows", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  const updated = catalog.upsertRatings(
    new Map([["tt0133093", { rating: 8.7, votes: 1000 }]]),
  );
  assert.equal(updated, 0);
  catalog.close();
});

test("rating ceiling keeps an unrated title and drops a higher rating", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "High",
    rating: 9,
    votes: 1000,
  });
  seedTitle(catalog, { id: "tt0000002", title: "Low", rating: 7, votes: 1000 });
  catalog.upsertTitles([{ id: "tt0000003", title: "Unrated" }]);
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    ratingMax: 8,
  });
  assert.deepEqual(page.data.map((title) => title.id).sort(), [
    "tt0000002",
    "tt0000003",
  ]);
  catalog.close();
});

test("titles are ready without credits", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 2_000_000,
  });
  catalog.setCatalogMeta({
    builtAt: new Date().toISOString(),
    revision: "test",
    source: "test",
  });
  assert.equal(catalog.titlesReady(), true);
  assert.equal(catalog.creditsReady(), false);
  catalog.close();
});

test("people rows do not mark credits ready", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    {
      id: "tt0133093",
      title: "The Matrix",
      directors: ["Lana Wachowski"],
      cast: ["Keanu Reeves"],
    },
  ]);
  catalog.setCatalogMeta({
    builtAt: "2026-10-03T00:00:00.000Z",
    revision: "test",
    source: "test",
  });
  assert.equal(catalog.titlesReady(), true);
  assert.equal(catalog.creditsReady(), false);

  catalog.insertPeople([
    {
      titleId: "tt0133093",
      nconst: "nm0905154",
      name: "Lilly Wachowski",
      role: "director",
      position: 1,
    },
  ]);
  assert.equal(catalog.creditsReady(), false);

  catalog.setCreditsReady(true);
  assert.equal(catalog.creditsReady(), true);
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
    {
      titleId: "tt0133093",
      nconst: "nm0905152",
      name: "Lana Wachowski",
      role: "director",
      position: 0,
    },
    {
      titleId: "tt0133093",
      nconst: "nm0000206",
      name: "Keanu Reeves",
      role: "cast",
      position: 0,
    },
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

test("rating sort uses displayed IMDb rating then votes", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt7286456",
    title: "Joker",
    rating: 8.3,
    votes: 1_700_000,
  });
  seedTitle(catalog, {
    id: "tt15354916",
    title: "The Kashmir Files",
    rating: 8.5,
    votes: 580_000,
  });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "rating",
    order: "desc",
  });
  assert.equal(page.data[0]?.id, "tt15354916");
  assert.equal(page.data[1]?.id, "tt7286456");
  catalog.close();
});

test("bayesian helper still weights vote counts", () => {
  assert.ok(bayesianScore(9, 500_000) > bayesianScore(10, 12));
});

test("FTS prefix search finds titles", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Unrelated",
    rating: 7,
    votes: 1000,
  });
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
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
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
  for (let index = 1; index <= 5; index += 1) {
    seedTitle(catalog, {
      id: `tt000000${index}`,
      title: `Title ${index}`,
      rating: 7,
      votes: 1000 + index,
    });
  }
  const page = catalog.listTitles({
    page: 1,
    pageSize: 2,
    sort: "title",
    order: "asc",
    includeTotal: false,
  });
  assert.equal(page.data.length, 2);
  assert.equal(page.pagination.total, null);
  assert.equal(page.pagination.totalPages, null);
  assert.equal(typeof page.pagination.nextCursor, "string");
  catalog.close();
});

test("a short cursor page does not report its length as the catalogue size", () => {
  const catalog = openCatalog();
  for (let index = 1; index <= 5; index += 1) {
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
    includeTotal: false,
  });
  const second = catalog.listTitles({
    page: 1,
    pageSize: 2,
    sort: "title",
    order: "asc",
    includeTotal: false,
    cursor: first.pagination.nextCursor ?? undefined,
  });
  const last = catalog.listTitles({
    page: 1,
    pageSize: 2,
    sort: "title",
    order: "asc",
    includeTotal: false,
    cursor: second.pagination.nextCursor ?? undefined,
  });
  assert.equal(last.data.length, 1);
  assert.equal(last.pagination.total, null);
  assert.equal(last.pagination.nextCursor, null);
  catalog.close();
});

test("includeTotal false reports the exact total when the page is short", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Only",
    rating: 7,
    votes: 1000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Pair",
    rating: 7,
    votes: 900,
  });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    includeTotal: false,
  });
  assert.equal(page.data.length, 2);
  assert.equal(page.pagination.total, 2);
  assert.equal(page.pagination.nextCursor, null);
  catalog.close();
});

test("rating updates do not rewrite the FTS index", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  const before = catalog.ftsShadowRowCount();
  catalog.upsertRatings(
    new Map([["tt0133093", { rating: 9.0, votes: 2_000_000 }]]),
  );
  assert.equal(catalog.title("tt0133093")?.imdbVotes, 2_000_000);
  assert.equal(catalog.ftsShadowRowCount(), before);
  catalog.close();
});

test("media writes do not wait on the catalog work queue", async () => {
  const { catalogWorkQueue, mediaWorkQueue } = await import("./work-queue.js");
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const catalogJob = catalogWorkQueue.enqueue(async () => {
    await blocked;
  });
  let mediaFinished = false;
  const mediaJob = mediaWorkQueue.enqueue(() => {
    mediaFinished = true;
  });
  await mediaJob;
  assert.equal(mediaFinished, true);
  release();
  await catalogJob;
});

test("renaming a title still finds it in FTS", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  catalog.upsertTitles([
    {
      id: "tt0133093",
      title: "The Matrix Reloaded",
      originalTitle: "The Matrix Reloaded",
      kind: "movie",
      year: 2003,
      runtimeMinutes: 138,
    },
  ]);
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    query: "reload",
  });
  assert.equal(page.data[0]?.id, "tt0133093");
  catalog.close();
});

test("known nconsts are resolved from the people table", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  catalog.insertPeople([
    {
      titleId: "tt0133093",
      nconst: "nm0000206",
      name: "Keanu Reeves",
      role: "cast",
      position: 0,
    },
  ]);
  const names = catalog.peopleNames(["nm0000206", "nm9999999"]);
  assert.equal(names.get("nm0000206"), "Keanu Reeves");
  assert.equal(names.has("nm9999999"), false);
  catalog.close();
});

test("skipped titles never appear in title search", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Skipped Film",
    rating: 8,
    votes: 1000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Open Film",
    rating: 8,
    votes: 1000,
  });
  catalog.saveLibrary("tt0000001", "skipped", null, null);
  const page = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
  });
  assert.equal(
    page.data.some((title) => title.id === "tt0000001"),
    false,
  );
  assert.equal(
    page.data.some((title) => title.id === "tt0000002"),
    true,
  );
  catalog.close();
});

test("GET title returns immediately with a null poster", async () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  const previousKeys = process.env.TMDB_API_KEYS;
  const previousKey = process.env.TMDB_API_KEY;
  const previousAppData = process.env.APPDATA;
  process.env.TMDB_API_KEYS = "";
  delete process.env.TMDB_API_KEY;
  process.env.APPDATA = join(tmpdir(), "rescore-no-tmdb");
  const server = createApp(new RatingsStore(catalog), catalog).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const started = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/titles/tt0133093`,
    );
    const elapsed = Date.now() - started;
    const body = (await response.json()) as {
      data: { posterUrl: string | null };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.posterUrl, null);
    assert.ok(elapsed < 500);
  } finally {
    if (previousKeys === undefined) delete process.env.TMDB_API_KEYS;
    else process.env.TMDB_API_KEYS = previousKeys;
    if (previousKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousKey;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    catalog.close();
  }
});

test("a title read does not enqueue poster hydration", async () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0133093",
    title: "The Matrix",
    rating: 8.7,
    votes: 1000,
  });
  const previousKeys = process.env.TMDB_API_KEYS;
  const previousKey = process.env.TMDB_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  process.env.TMDB_API_KEYS = "title-read-key";
  delete process.env.TMDB_API_KEY;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("127.0.0.1") || url.includes("localhost"))
      return originalFetch(input, init);
    fetches += 1;
    return Response.json({ movie_results: [], tv_results: [] });
  };
  const server = createApp(new RatingsStore(catalog), catalog).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/titles/tt0133093`,
    );
    const body = (await response.json()) as {
      data: { id: string; posterUrl: string | null };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.id, "tt0133093");
    assert.equal(body.data.posterUrl, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches, 0);
  } finally {
    if (previousKeys === undefined) delete process.env.TMDB_API_KEYS;
    else process.env.TMDB_API_KEYS = previousKeys;
    if (previousKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousKey;
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    catalog.close();
  }
});

test("votes sort pages with a cursor instead of offset", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "Low", rating: 7, votes: 10 });
  seedTitle(catalog, { id: "tt0000002", title: "Mid", rating: 7, votes: 20 });
  seedTitle(catalog, { id: "tt0000003", title: "High", rating: 7, votes: 30 });
  const first = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
  });
  assert.equal(first.data[0]?.id, "tt0000003");
  assert.equal(typeof first.pagination.nextCursor, "string");
  const second = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
    cursor: first.pagination.nextCursor ?? undefined,
  });
  assert.equal(second.data[0]?.id, "tt0000002");
  const third = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
    cursor: second.pagination.nextCursor ?? undefined,
  });
  assert.equal(third.data[0]?.id, "tt0000001");
  assert.equal(third.pagination.nextCursor, null);
  catalog.close();
});

test("votes sort cursor paging does not skip a title with null votes", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000003", title: "High", rating: 7, votes: 30 });
  seedTitle(catalog, { id: "tt0000002", title: "Mid", rating: 7, votes: 20 });
  catalog.insertTitleRows([
    {
      id: "tt0000001",
      title: "NoVotes",
      originalTitle: "NoVotes",
      kind: "movie",
      year: 1999,
      runtimeMinutes: 120,
      imdbRating: null,
      imdbVotes: null,
      genres: ["Action"],
    },
  ]);
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i += 1) {
    const page = catalog.listTitles({
      page: 1,
      pageSize: 1,
      sort: "votes",
      order: "desc",
      includeTotal: false,
      cursor,
    });
    if (!page.data.length) break;
    seen.push(...page.data.map((title) => title.id));
    if (!page.pagination.nextCursor) break;
    cursor = page.pagination.nextCursor;
  }
  assert.deepEqual(seen, ["tt0000003", "tt0000002", "tt0000001"]);
  catalog.close();
});

test("rating sort cursor paging keeps the votes tie-break across pages", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000009",
    title: "More Votes",
    rating: 8,
    votes: 100,
  });
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Fewer Votes",
    rating: 8,
    votes: 50,
  });
  const first = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "rating",
    order: "desc",
    includeTotal: false,
  });
  assert.equal(first.data[0]?.id, "tt0000009");
  assert.equal(typeof first.pagination.nextCursor, "string");
  const second = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "rating",
    order: "desc",
    includeTotal: false,
    cursor: first.pagination.nextCursor ?? undefined,
  });
  assert.equal(second.data[0]?.id, "tt0000001");
  assert.equal(second.pagination.nextCursor, null);
  catalog.close();
});

test("cursor paging matches one full read for every sort, order, and null lead", () => {
  const catalog = openCatalog();
  const values = [null, 1990, 2005, 2005, 2020];
  catalog.insertTitleRows(
    Array.from({ length: 23 }, (_, i) => ({
      id: `tt${String(i + 1).padStart(7, "0")}`,
      title: `Title ${i % 4}`,
      originalTitle: `Title ${i % 4}`,
      kind: i % 7 === 6 ? "tv" : "movie",
      year: values[i % 5]!,
      runtimeMinutes: 100,
      imdbRating: i % 6 === 0 ? null : 6 + (i % 3),
      imdbVotes: i % 5 === 0 ? null : 100 * (i % 4),
      genres: ["Drama"],
    })),
  );
  for (const sort of ["votes", "rating", "year", "title"] as const) {
    for (const order of ["asc", "desc"] as const) {
      for (const kind of [undefined, "movie"]) {
        const base = { page: 1, sort, order, kind, includeTotal: false };
        const all = catalog
          .listTitles({ ...base, pageSize: 100 })
          .data.map((title) => title.id);
        const paged: string[] = [];
        let cursor: string | undefined;
        do {
          const page = catalog.listTitles({ ...base, pageSize: 2, cursor });
          paged.push(...page.data.map((title) => title.id));
          cursor = page.pagination.nextCursor ?? undefined;
        } while (cursor);
        assert.deepEqual(paged, all, `${sort} ${order} ${kind ?? "any"}`);
      }
    }
  }
  catalog.close();
});

test("a common search word pages the same through the sort index as through the full-text join", () => {
  const catalog = openCatalog();
  const years = [null, 1990, 2005, 2005, 2020];
  catalog.insertTitleRows(
    Array.from({ length: FTS_SET_THRESHOLD + 150 }, (_, i) => ({
      id: `tt${String(i + 1).padStart(7, "0")}`,
      title: i % 50 === 0 ? `Other ${i}` : `Word ${i % 300}`,
      originalTitle: null,
      kind: "movie",
      year: years[i % 5]!,
      runtimeMinutes: 100,
      imdbRating: i % 7 === 0 ? null : 5 + (i % 5),
      imdbVotes: i % 11 === 0 ? null : 10 * (i % 40),
      genres: ["Drama"],
    })),
  );
  catalog.saveLibrary("tt0000002", "watched", 8, null);
  // Every title is a movie: with `kind` the common word walks the sort
  // index, without it the same query reads the full-text join.
  const read = (
    query: string,
    kind: string | undefined,
    sort: "votes" | "rating" | "year",
    order: "asc" | "desc",
  ) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = catalog.listTitles({
        page: 1,
        pageSize: 40,
        sort,
        order,
        kind,
        query,
        hideWatched: true,
        includeTotal: false,
        cursor,
      });
      ids.push(...page.data.map((title) => title.id));
      cursor = page.pagination.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };
  for (const query of ["word", "other", "zzyzx"]) {
    for (const sort of ["votes", "rating", "year"] as const) {
      for (const order of ["asc", "desc"] as const) {
        const viaIndex = read(query, "movie", sort, order);
        assert.deepEqual(
          viaIndex,
          read(query, undefined, sort, order),
          `${query} ${sort} ${order}`,
        );
        if (query === "word") {
          assert.ok(
            viaIndex.length > FTS_SET_THRESHOLD,
            "enough matches for the index walk",
          );
          assert.ok(
            !viaIndex.includes("tt0000002"),
            "watched title stays hidden",
          );
        }
      }
    }
  }
  catalog.close();
});

test("a full final page reports no further cursor", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "A", rating: 7, votes: 10 });
  seedTitle(catalog, { id: "tt0000002", title: "B", rating: 7, votes: 20 });
  const page = catalog.listTitles({
    page: 1,
    pageSize: 2,
    sort: "votes",
    order: "desc",
    kind: "movie",
    includeTotal: false,
  });
  assert.equal(page.data.length, 2);
  assert.equal(page.pagination.nextCursor, null);
  catalog.close();
});

test("poster candidates stay limited to the requested ids", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Shown",
    rating: 8,
    votes: 100,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Hidden",
    rating: 8,
    votes: 90,
  });
  const rows = catalog.listTitlesNeedingPosters(50, ["tt0000001"], false);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["tt0000001"],
  );
  catalog.close();
});

test("library visibility keeps a watchlist title in For You and hides watched on Discover", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Watched",
    rating: 8,
    votes: 10_000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Watchlist",
    rating: 8,
    votes: 9_000,
  });
  seedTitle(catalog, {
    id: "tt0000003",
    title: "Skipped",
    rating: 8,
    votes: 8_000,
  });
  seedTitle(catalog, {
    id: "tt0000004",
    title: "Open",
    rating: 8,
    votes: 7_000,
  });
  seedTitle(catalog, {
    id: "tt0000005",
    title: "Quiet",
    rating: 8,
    votes: 4_999,
  });
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  catalog.saveLibrary("tt0000002", "watchlist", null, null);
  catalog.saveLibrary("tt0000003", "skipped", null, null);
  const discover = catalog.listTitles({
    page: 1,
    pageSize: 10,
    sort: "title",
    order: "asc",
    hideWatched: true,
  });
  const discoverIds = discover.data.map((title) => title.id);
  assert.equal(discoverIds.includes("tt0000001"), false);
  assert.equal(discoverIds.includes("tt0000003"), false);
  assert.equal(discoverIds.includes("tt0000002"), true);
  assert.equal(discoverIds.includes("tt0000004"), true);
  const candidates = catalog.listForYouCandidates(50).map((title) => title.id);
  assert.deepEqual(candidates, ["tt0000002", "tt0000004"]);
  catalog.close();
});

test("for-you candidates exclude watched and skipped", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Watched",
    rating: 8,
    votes: 10_000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Open",
    rating: 8,
    votes: 9_000,
  });
  seedTitle(catalog, {
    id: "tt0000003",
    title: "Skipped",
    rating: 8,
    votes: 8_000,
  });
  catalog.setCatalogMeta({
    builtAt: new Date().toISOString(),
    revision: "test",
    source: "test",
  });
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  catalog.saveLibrary("tt0000003", "skipped", null, null);
  const candidates = catalog.listForYouCandidates(50);
  assert.equal(
    candidates.some((title) => title.id === "tt0000001"),
    false,
  );
  assert.equal(
    candidates.some((title) => title.id === "tt0000003"),
    false,
  );
  assert.equal(
    candidates.some((title) => title.id === "tt0000002"),
    true,
  );
  catalog.close();
});

test("excluded genres and people narrow the page", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    {
      id: "tt0000001",
      title: "Horror One",
      kind: "movie",
      genres: ["Horror"],
      directors: ["Jane Doe"],
    },
    {
      id: "tt0000002",
      title: "Comedy Two",
      kind: "movie",
      genres: ["Comedy"],
      cast: ["Jane Doe"],
    },
  ]);
  const base = {
    page: 1,
    pageSize: 10,
    sort: "title" as const,
    order: "asc" as const,
    includeTotal: false,
  };
  assert.deepEqual(
    catalog
      .listTitles({ ...base, withoutGenres: ["Horror"] })
      .data.map((row) => row.id),
    ["tt0000002"],
  );
  assert.deepEqual(
    catalog
      .listTitles({ ...base, directors: ["Jane Doe"] })
      .data.map((row) => row.id),
    ["tt0000001"],
  );
  assert.deepEqual(
    catalog
      .listTitles({ ...base, cast: ["Jane Doe"] })
      .data.map((row) => row.id),
    ["tt0000002"],
  );
  catalog.close();
});

test("excluded languages drop a title when any stored language matches", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    { id: "tt0000001", title: "Both", kind: "movie" },
    { id: "tt0000002", title: "Japanese", kind: "movie" },
    { id: "tt0000003", title: "Unknown", kind: "movie" },
  ]);
  catalog.updatePosterUrls([
    { id: "tt0000001", languages: ["fr", "en"] },
    { id: "tt0000002", languages: ["JA"] },
  ]);
  const base = {
    page: 1,
    pageSize: 10,
    sort: "title" as const,
    order: "asc" as const,
    includeTotal: false,
  };
  assert.equal(catalog.titleNeedsLanguages("tt0000003"), true);
  assert.equal(catalog.titleNeedsLanguages("tt0000001"), false);
  assert.deepEqual(catalog.title("tt0000001")?.languages, ["fr", "en"]);
  assert.deepEqual(
    catalog
      .listTitles({ ...base, withoutLanguages: ["en"] })
      .data.map((row) => row.id),
    ["tt0000002", "tt0000003"],
  );
  assert.deepEqual(
    catalog
      .listTitles({ ...base, withoutLanguages: ["ja", "fr"] })
      .data.map((row) => row.id),
    ["tt0000003"],
  );
  catalog.close();
});

test("tmdb coverage counts filled posters, synopses, and age ratings", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    { id: "tt0000001", title: "Filled", kind: "movie" },
    { id: "tt0000002", title: "Poster only", kind: "movie" },
    { id: "tt0000003", title: "Empty", kind: "movie" },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
      synopsis: "A synopsis.",
      certification: "PG-13",
    },
    {
      id: "tt0000002",
      posterUrl: "https://image.tmdb.org/t/p/w500/b.jpg",
    },
  ]);
  assert.deepEqual(catalog.tmdbCoverage(), {
    total: 3,
    posters: 2,
    synopses: 1,
    certifications: 1,
  });
  catalog.close();
});

test("tmdb hydration keeps confirmed misses complete and certifications pending", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    { id: "tt0000001", title: "Confirmed miss", kind: "movie" },
    { id: "tt0000002", title: "Needs certification", kind: "movie" },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: null,
      synopsis: null,
      certification: "",
      languages: [],
    },
    {
      id: "tt0000002",
      posterUrl: "https://image.tmdb.org/t/p/w500/b.jpg",
      synopsis: "A synopsis.",
    },
  ]);

  assert.equal(catalog.titleNeedsMedia("tt0000001"), false);
  assert.equal(catalog.titleNeedsMedia("tt0000002"), true);
  assert.deepEqual(catalog.hydrationStats(), {
    total: 2,
    processed: 1,
    pending: 1,
    complete: false,
  });
  assert.deepEqual(
    catalog.listTitlesNeedingPosters(10, [], true).map((title) => title.id),
    ["tt0000002"],
  );
  catalog.close();
});

test("stale missing metadata is retried in bounded batches without replacing existing data", (t) => {
  const catalog = openCatalog();
  let time = 1_000;
  t.mock.method(Date, "now", () => time);
  catalog.upsertTitles([
    { id: "tt0000001", title: "Missing synopsis", kind: "movie" },
    { id: "tt0000002", title: "Missing poster", kind: "movie" },
    { id: "tt0000003", title: "Complete", kind: "movie" },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://example.com/keep.jpg",
      synopsis: null,
      certification: "PG",
      languages: ["en"],
    },
    {
      id: "tt0000002",
      posterUrl: null,
      synopsis: "Keep this synopsis",
      certification: "",
      languages: [],
    },
    {
      id: "tt0000003",
      posterUrl: "https://example.com/full.jpg",
      synopsis: "Complete",
      certification: "",
      languages: [],
    },
  ]);
  assert.deepEqual(catalog.requeueMissingMedia(999, 10), []);
  assert.deepEqual(catalog.requeueMissingMedia(1_000, 1), ["tt0000001"]);
  assert.equal(catalog.titleNeedsMedia("tt0000001"), true);
  time = 2_000;
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: null,
      synopsis: "New synopsis",
      certification: "",
      languages: [],
    },
  ]);
  assert.equal(
    catalog.title("tt0000001")?.posterUrl,
    "https://example.com/keep.jpg",
  );
  assert.equal(catalog.title("tt0000001")?.synopsis, "New synopsis");
  assert.equal(catalog.title("tt0000001")?.certification, "PG");
  assert.deepEqual(catalog.title("tt0000001")?.languages, ["en"]);
  assert.deepEqual(catalog.requeueMissingMedia(1_000, 10), ["tt0000002"]);
  catalog.updatePosterUrls([
    {
      id: "tt0000002",
      posterUrl: "https://example.com/new.jpg",
      synopsis: null,
      languages: [],
    },
  ]);
  assert.equal(catalog.title("tt0000002")?.synopsis, "Keep this synopsis");
  assert.deepEqual(catalog.requeueMissingMedia(3_000, 10), []);
  catalog.close();
});

test("missing metadata retry timestamps survive reopening and legacy misses are eligible", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-retry-"));
  dirs.push(dir);
  const path = join(dir, "catalog.sqlite");
  let catalog = new CatalogDatabase(path);
  t.mock.method(Date, "now", () => 5_000);
  catalog.upsertTitles([
    { id: "tt0000001", title: "Recent miss", kind: "movie" },
    {
      id: "tt0000002",
      title: "Legacy miss",
      kind: "movie",
      posterUrl: "",
      synopsis: "",
    },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: null,
      synopsis: null,
      certification: "",
      languages: [],
    },
    { id: "tt0000002", certification: "", languages: [] },
  ]);
  catalog.close();
  catalog = new CatalogDatabase(path);
  assert.deepEqual(catalog.requeueMissingMedia(4_999, 10), ["tt0000002"]);
  assert.deepEqual(catalog.requeueMissingMedia(5_000, 10), ["tt0000001"]);
  catalog.close();
});

test("retry migration preserves an existing catalogue and makes old misses eligible", () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-retry-upgrade-"));
  dirs.push(dir);
  const path = join(dir, "catalog.sqlite");
  const old = new Database(path);
  try {
    migrations.slice(0, -1).forEach((sql, index) => {
      old.exec(sql);
      old
        .prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        )
        .run(index + 1, "2026-10-10");
    });
    old.exec(`INSERT INTO titles(id, title, kind, updated_at, poster_url, synopsis, certification, languages_checked)
      VALUES ('tt0000001', 'Legacy title', 'movie', '2026-10-10', '', 'Keep this synopsis', 'PG', 1);
      INSERT INTO library_entries(title_id, status, personal_rating, updated_at)
      VALUES ('tt0000001', 'watched', 8, '2026-10-10');`);
  } finally {
    old.close();
  }
  const catalog = new CatalogDatabase(path);
  try {
    assert.deepEqual(catalog.requeueMissingMedia(Date.now(), 400), [
      "tt0000001",
    ]);
    assert.equal(catalog.title("tt0000001")?.synopsis, "Keep this synopsis");
    assert.equal(catalog.title("tt0000001")?.certification, "PG");
    assert.equal(catalog.listLibrary()[0]?.personalRating, 8);
  } finally {
    catalog.close();
  }
});

test("complete media still leaves a title pending until languages are checked", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    { id: "tt0000001", title: "Needs languages", kind: "movie" },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
      synopsis: "A synopsis.",
      certification: "PG-13",
    },
  ]);

  assert.equal(catalog.titleNeedsMedia("tt0000001"), true);
  assert.equal(catalog.titleNeedsLanguages("tt0000001"), true);
  assert.deepEqual(catalog.hydrationStats(), {
    total: 1,
    processed: 0,
    pending: 1,
    complete: false,
  });
  assert.deepEqual(
    catalog.listTitlesNeedingPosters(10, [], true).map((title) => title.id),
    ["tt0000001"],
  );

  catalog.updatePosterUrls([{ id: "tt0000001", languages: [] }]);

  assert.equal(catalog.titleNeedsMedia("tt0000001"), false);
  assert.equal(catalog.titleNeedsLanguages("tt0000001"), false);
  assert.deepEqual(catalog.hydrationStats(), {
    total: 1,
    processed: 1,
    pending: 0,
    complete: true,
  });
  assert.deepEqual(catalog.listTitlesNeedingPosters(10, [], true), []);
  catalog.close();
});

test("library write returns the saved row and leaves the other rows", () => {
  const catalog = openCatalog();
  for (const [id, title] of [
    ["tt0000001", "One"],
    ["tt0000002", "Two"],
    ["tt0000003", "Three"],
  ] as const) {
    seedTitle(catalog, { id, title, rating: 7, votes: 1000 });
  }
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  catalog.saveLibrary("tt0000003", "skipped", null, null);
  const saved = catalog.saveLibrary("tt0000002", "watchlist", 6, "later");
  assert.equal(saved?.title.id, "tt0000002");
  assert.equal(saved?.status, "watchlist");
  assert.equal(saved?.personalRating, 6);
  assert.equal(saved?.note, "later");
  assert.equal(catalog.listLibrary().length, 3);
  catalog.close();
});

test("library write remove returns the removed row", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "Watched",
    rating: 8,
    votes: 1000,
  });
  catalog.saveLibrary("tt0000001", "watched", 8, "seen");
  const removed = catalog.deleteLibrary("tt0000001");
  assert.equal(removed?.title.id, "tt0000001");
  assert.equal(removed?.status, "watched");
  assert.equal(removed?.personalRating, 8);
  assert.equal(removed?.note, "seen");
  assert.equal(catalog.listLibrary().length, 0);
  assert.equal(catalog.deleteLibrary("tt0000001"), null);
  catalog.close();
});

test("library write clear returns every removed row", () => {
  const catalog = openCatalog();
  seedTitle(catalog, {
    id: "tt0000001",
    title: "One",
    rating: 8,
    votes: 1000,
  });
  seedTitle(catalog, {
    id: "tt0000002",
    title: "Two",
    rating: 7,
    votes: 1000,
  });
  catalog.saveLibrary("tt0000001", "watched", 8, null);
  catalog.saveLibrary("tt0000002", "watchlist", null, null);
  const removed = catalog.clearLibrary().map((entry) => entry.title.id);
  assert.deepEqual(removed.sort(), ["tt0000001", "tt0000002"]);
  assert.equal(catalog.listLibrary().length, 0);
  catalog.close();
});
