import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "../../../shared/types";
import {
  activeFilterCount,
  compactCount,
  FILTER_FIELDS,
  resetFilters,
  type FilterFieldId,
} from "./filter-fields";

const genres = [
  { id: 18, name: "Drama" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 10749, name: "Romance" },
];
const field = (id: FilterFieldId) => FILTER_FIELDS.find((f) => f.id === id)!;

test("a fresh search has no active filters", () => {
  assert.equal(activeFilterCount(defaultFilters()), 0);
});

test("the bar shows every filter, runtime included", () => {
  assert.deepEqual(
    FILTER_FIELDS.map((f) => f.id),
    ["genres", "released", "quality", "runtime", "languages", "library"],
  );
});

test("each changed field counts once; query, type and sort are ignored", () => {
  const filters = {
    ...defaultFilters(),
    query: "heat",
    titleKind: "tv" as const,
    sortBy: "popularity.desc",
    genres: [80, 18],
    withoutGenres: [27],
    hideWatched: false,
    runtimeMax: 120,
  };
  assert.equal(activeFilterCount(filters), 3);
});

test("pill summaries read as the current setting", () => {
  const filters = {
    ...defaultFilters(),
    genres: [18, 35, 80],
    withoutGenres: [10749],
    ratingMin: 7.5,
    voteCountMin: 1500,
    excludeLanguages: [],
    hideWatchlist: true,
  };
  assert.equal(
    field("genres").summary(filters, genres),
    "Drama, Comedy, Crime; not Romance",
  );
  assert.equal(field("genres").summary(defaultFilters(), genres), "Any");
  assert.deepEqual(field("genres").exclusionTail!(filters, genres), {
    lead: "Drama, Comedy, Crime",
    excluded: ["Romance"],
  });
  assert.deepEqual(
    field("genres").exclusionTail!(
      { ...defaultFilters(), withoutGenres: [18, 80] },
      genres,
    ),
    { lead: "Any", excluded: ["Drama", "Crime"] },
    "exclusions alone still lead with Any",
  );
  assert.equal(
    field("quality").summary(filters, genres),
    "IMDb 7.5+, 1.5k+ votes",
  );
  assert.equal(field("runtime").summary(filters, genres), "Any length");
  assert.equal(field("languages").summary(filters, genres), "no languages");
  assert.equal(
    field("library").summary(filters, genres),
    "watched and watchlist",
  );
});

test("reset clears every filter but keeps the query, type and sort", () => {
  const filters = {
    ...defaultFilters(),
    query: "heat",
    titleKind: "tv" as const,
    sortBy: "popularity.desc",
    genres: [18],
    ratingMin: 5,
    runtimeMax: 90,
    page: 3,
  };
  const reset = resetFilters(filters);
  assert.equal(activeFilterCount(reset), 0);
  assert.equal(reset.query, "heat");
  assert.equal(reset.titleKind, "tv");
  assert.equal(reset.sortBy, "popularity.desc");
  assert.equal(reset.page, 1);
});

test("an open range end matches its slider limit", () => {
  const filters = { ...defaultFilters(), yearMax: null, runtimeMin: 0 };
  assert.equal(activeFilterCount(filters), 0);
  assert.equal(activeFilterCount({ ...filters, yearMax: 2015 }), 1);
});

test("vote counts shorten to thousands", () => {
  assert.equal(compactCount(950), "950");
  assert.equal(compactCount(1000), "1k");
  assert.equal(compactCount(2500), "2.5k");
});
