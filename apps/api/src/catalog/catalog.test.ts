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

const dirs: string[] = [];

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
  const previousKey = process.env.TMDB_API_KEY;
  const previousAppData = process.env.APPDATA;
  delete process.env.TMDB_API_KEY;
  process.env.APPDATA = join(tmpdir(), "rescore-no-tmdb");
  const server = createApp(new RatingsStore(catalog), catalog).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/v1/titles/tt0133093`);
    const elapsed = Date.now() - started;
    const body = (await response.json()) as {
      data: { posterUrl: string | null };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.posterUrl, null);
    assert.ok(elapsed < 500);
  } finally {
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
