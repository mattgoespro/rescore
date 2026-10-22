import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "../../../shared/types";
import { activeFilterCount } from "./active-filters";

test("a fresh search has no active filters", () => {
  assert.equal(activeFilterCount(defaultFilters()), 0);
});

test("each changed criterion counts once; query and sort are ignored", () => {
  const filters = {
    ...defaultFilters(),
    query: "heat",
    genres: [80, 18],
    withoutGenres: [27],
    hideWatched: false,
    sortBy: "popularity.desc",
  };
  assert.equal(activeFilterCount(filters), 3);
});
