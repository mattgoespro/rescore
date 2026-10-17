import { defaultFilters } from "../shared/filters";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLibraryTasteWorkflow,
  type LibraryCatalogue,
} from "./library-taste";
import { movieFromTitle } from "../shared/movie";
import type { LibraryEntry } from "../shared/types";
const movie = movieFromTitle({
  id: "tt1",
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
function fixture() {
  let library: LibraryEntry[] = [];
  const writes: unknown[][] = [];
  let reads = 0;
  const client: LibraryCatalogue = {
    listLibrary: async () => {
      reads++;
      return library;
    },
    genres: async () => [],
    saveLibrary: async (m, status, rating, ratedAt) => {
      writes.push([m.imdbId, status, rating, ratedAt]);
      library = [
        {
          ...m,
          status,
          rating,
          ratedAt,
          updatedAt: "2026-01-01",
          directorIds: [],
          directorNames: [],
          castIds: [],
          castNames: [],
        },
      ];
    },
    removeLibrary: async () => {
      library = [];
    },
    clearLibrary: async () => {
      const old = library;
      library = [];
      return old;
    },
    findByImdb: async (id) => (id === "tt404" ? null : movie),
    discover: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [{ ...movie, match: 0, reasons: [] }],
      nextCursor: null,
      canLoadMore: false,
    }),
    forYouPage: async () => ({
      library: [],
      facets: { genres: [], kinds: [], years: { min: null, max: null } },
      candidates: [],
    }),
  };
  let identity = "a";
  const workflow = createLibraryTasteWorkflow({
    connection: () => ({ identity, url: "http://fixture" }),
    createClient: () => client,
    rankingMode: () => "balanced",
  });
  return {
    workflow,
    client,
    writes,
    get reads() {
      return reads;
    },
    setIdentity: (x: string) => {
      identity = x;
    },
  };
}

test("Library edits and CSV import share write dates, invalidation, and progress", async () => {
  const f = fixture();
  const filters = { ...defaultFilters(), sortBy: "match" };
  await f.workflow.discover(filters);
  await f.workflow.discover(filters);
  assert.equal(f.reads, 1);
  const rows = await f.workflow.upsert({
    movie,
    status: "watched",
    rating: 8,
    ratedAt: "2012-04-05T00:00:00.000Z",
  });
  assert.equal(rows[0].ratedAt, "2012-04-05T00:00:00.000Z");
  await f.workflow.discover(filters);
  assert.equal(f.reads, 3);
  const progress: number[] = [];
  const result = await f.workflow.importRatings(
    [
      {
        imdbId: "tt1",
        title: "Fixture",
        titleType: "movie",
        rating: 9,
        dateRated: "2001-01-01T00:00:00.000Z",
      },
      { imdbId: "tt404", title: "Missing", titleType: "movie", rating: 7 },
    ],
    (p) => progress.push(p.current),
  );
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.done, true);
  assert.deepEqual(f.writes.at(-1), [
    "tt1",
    "watched",
    9,
    "2001-01-01T00:00:00.000Z",
  ]);
  assert.deepEqual(progress, [1, 2, 2]);
  assert.deepEqual(await f.workflow.clear(), []);
});

test("a Library read cannot publish after its catalogue identity changes", async () => {
  const f = fixture();
  let resolve!: (rows: LibraryEntry[]) => void;
  f.client.listLibrary = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.workflow.list();
  f.setIdentity("b");
  resolve([]);
  await assert.rejects(pending, /Catalogue changed/);
});

test("partial import failures count errors and invalidate previously cached taste", async () => {
  const f = fixture();
  let saves = 0;
  f.client.saveLibrary = async () => {
    if (++saves === 1) throw new Error("failed");
  };
  const result = await f.workflow.importRatings([
    { imdbId: "tt1", title: "A", titleType: "movie", rating: 7 },
    { imdbId: "tt2", title: "B", titleType: "movie", rating: 8 },
  ]);
  assert.equal(result.errors, 1);
  assert.equal(result.imported, 1);
});

test("For You ranks from its response context rather than a warmed Discover cache", async () => {
  const f = fixture();
  await f.workflow.discover({ ...defaultFilters(), sortBy: "match" });
  const reads = f.reads;
  const title = {
    id: "tt1",
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
    genres: ["Drama"],
    directors: [],
    cast: [],
    languages: [],
  };
  f.client.forYouPage = async () => ({
    library: [1, 2, 3].map((id) => ({
      title: { ...title, id: `tt${id}` },
      status: "watched",
      personalRating: 8,
      ratedAt: "2001-01-01T00:00:00.000Z",
      note: null,
      updatedAt: "2026-01-01",
    })),
    facets: {
      genres: [{ value: "Drama", count: 3 }],
      kinds: [],
      years: { min: 2000, max: 2000 },
    },
    candidates: [{ ...title, id: "tt4" }],
  });
  const result = await f.workflow.forYou();
  assert.equal(result.profile.ready, true);
  assert.equal(result.profile.ratedCount, 3);
  assert.equal(f.reads, reads);
  assert.equal(result.movies[0].imdbId, "tt4");
});
