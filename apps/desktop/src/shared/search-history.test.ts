import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters, type DiscoverFilters } from "./filters";
import {
  isDefaultSearchHistory,
  shouldRecordSearchHistory,
  snapshotSearchHistory,
  applySearchHistory,
  normalizeSearchHistory,
  upsertSearchHistory,
} from "./search-history";

test("non-default filters are recordable immediately", () => {
  const snapshot = snapshotSearchHistory(
    { ...defaultFilters(), sortBy: "vote_average.desc", genres: [18] },
    [{ id: 18, name: "Drama" }],
  );
  assert.equal(isDefaultSearchHistory(snapshot), false);
  assert.equal(shouldRecordSearchHistory({ saved: false, snapshot }), true);
});

test("history round trips the whole form and clears unrelated current filters", () => {
  const filters: DiscoverFilters = {
    ...defaultFilters(),
    query: "Heat",
    voteCountMin: 5000,
    runtimeMax: 180,
    withoutGenres: [5],
    excludeLanguages: ["fr"],
    hideWatched: false,
  };
  const [entry] = normalizeSearchHistory(
    upsertSearchHistory([], snapshotSearchHistory(filters, [])),
  );
  assert.deepEqual(
    applySearchHistory(
      { ...defaultFilters(), query: "unrelated", runtimeMin: 200 },
      entry,
    ),
    filters,
  );
  assert.equal(
    isDefaultSearchHistory(
      snapshotSearchHistory({ ...defaultFilters(), query: "Heat" }, []),
    ),
    false,
  );
});

test("saved exclusions retain IMDb and compatibility codes but reject unknown values", () => {
  const snapshot = snapshotSearchHistory(defaultFilters(), []);
  const [entry] = normalizeSearchHistory([
    {
      ...snapshot,
      id: "languages",
      savedAt: "fixture",
      filters: {
        ...snapshot.filters,
        excludeLanguages: [
          "ase",
          "tlh",
          "zxx",
          "cn",
          "iw",
          "ig",
          "nb",
          "nn",
          "fy",
          "not-a-language",
          123,
          null,
        ],
      },
    },
  ]);
  assert.deepEqual(
    applySearchHistory(defaultFilters(), entry).excludeLanguages,
    ["ase", "tlh", "zxx", "cn", "iw", "ig", "nb", "nn", "fy"],
  );
});

test("legacy history restores saved fields over defaults, not the active search", () => {
  const entry = {
    id: "old",
    savedAt: "fixture",
    titleKind: "tv" as const,
    genres: [{ id: 1, name: "Drama" }],
    yearMin: 1990,
    yearMax: 2000,
    ratingMin: 8,
    sortBy: "vote_average.desc",
  };
  const restored = applySearchHistory(
    {
      ...defaultFilters(),
      query: "unrelated",
      voteCountMin: 999999,
      runtimeMin: 200,
    },
    entry,
  );
  assert.equal(restored.query, "");
  assert.equal(restored.voteCountMin, defaultFilters().voteCountMin);
  assert.equal(restored.runtimeMin, null);
  assert.deepEqual(restored.genres, [1]);
});

test("default filters are not recorded", () => {
  const snapshot = snapshotSearchHistory(defaultFilters(), []);
  assert.equal(isDefaultSearchHistory(snapshot), true);
  assert.equal(shouldRecordSearchHistory({ saved: false, snapshot }), false);
});

test("saved empty language exclusions override the defaults when replayed", () => {
  const filters: DiscoverFilters = {
    ...defaultFilters(),
    excludeLanguages: [],
  };
  const [entry] = normalizeSearchHistory(
    upsertSearchHistory([], snapshotSearchHistory(filters, [])),
  );
  assert.deepEqual(
    applySearchHistory(defaultFilters(), entry).excludeLanguages,
    [],
  );
});

test("already-saved sessions are not recorded again", () => {
  const snapshot = snapshotSearchHistory(
    { ...defaultFilters(), sortBy: "vote_average.desc" },
    [],
  );
  assert.equal(shouldRecordSearchHistory({ saved: true, snapshot }), false);
});
