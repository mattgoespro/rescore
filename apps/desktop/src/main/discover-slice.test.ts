import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "../shared/filters";
import type { RankedMovie } from "../shared/ranking-types";
import {
  DISCOVER_PAGE_SIZE,
  discoverQueryParams,
  loadDiscoverSlice,
} from "./discover-slice";

test("discover query omits the rating ceiling and fixes the page size", () => {
  const params = discoverQueryParams(
    { ...defaultFilters(), ratingMin: 0, voteCountMin: 0, sortBy: "match", cursor: "abc" },
    { genres: ["Action"], withoutGenres: [] },
  );
  assert.equal(DISCOVER_PAGE_SIZE, 40);
  assert.equal(params.pageSize, 40);
  assert.equal(params.limit, 40);
  assert.equal(params.includeTotal, "false");
  assert.equal(params.sort, "votes");
  assert.equal(params.cursor, "abc");
  assert.equal(params.genre, "Action");
  assert.equal("ratingMax" in params, false);
  assert.equal("ratingMin" in params, false);
  assert.equal("votesMin" in params, false);
});

function summary(imdbId: string): RankedMovie {
  return {
    imdbId,
    mediaType: "movie",
    titleKind: "movie",
    title: imdbId,
    overview: "",
    posterPath: null,
    backdropPath: null,
    releaseDate: "",
    genreIds: [],
    originalLanguage: "",
    popularity: 0,
    voteAverage: 0,
    voteCount: 0,
    adult: false,
    match: 0,
    reasons: [],
  };
}

test("replace clears the cursor and match re-rank touches only the new page", async () => {
  let received: string | null = "unset";
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "match" },
    mode: "replace",
    cursor: "old",
    ratedCount: 3,
    fetchPage: async (filters) => {
      received = filters.cursor ?? null;
      return {
        page: 1,
        totalPages: 2,
        totalResults: 80,
        results: [summary("tt1"), summary("tt2")],
        nextCursor: "next",
        canLoadMore: false,
      };
    },
    rankPage: (movies) => [...movies].reverse(),
  });
  assert.equal(received, null);
  assert.deepEqual(page.results.map((movie) => movie.imdbId), ["tt2", "tt1"]);
  assert.equal(page.nextCursor, "next");
  assert.equal(page.canLoadMore, false);
});

test("match under three rated titles keeps catalogue order", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "match" },
    mode: "append",
    cursor: "keep",
    ratedCount: 2,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [summary("tt1")],
      nextCursor: null,
      canLoadMore: false,
    }),
    rankPage: () => {
      throw new Error("rankPage must not run");
    },
  });
  assert.equal(page.results[0].imdbId, "tt1");
});

test("a full page with a cursor can load another", async () => {
  const results = Array.from({ length: 40 }, (_, index) => summary(`tt${index}`));
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 9,
    fetchPage: async (filters) => {
      assert.equal(filters.cursor, "cursor-value");
      return { page: 1, totalPages: 2, totalResults: 80, results, nextCursor: "next", canLoadMore: false };
    },
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, true);
  assert.equal(page.nextCursor, "next");
});

test("a short page is the end even with a cursor", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 0,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 12,
      results: Array.from({ length: 12 }, (_, index) => summary(`tt${index}`)),
      nextCursor: "cursor-value",
      canLoadMore: true,
    }),
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, false);
});

test("an exactly full last page does not request page one again", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 0,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 40,
      results: Array.from({ length: 40 }, (_, index) => summary(`tt${index}`)),
      nextCursor: null,
      canLoadMore: true,
    }),
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, false);
});
