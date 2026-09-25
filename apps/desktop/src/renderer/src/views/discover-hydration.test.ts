import assert from "node:assert/strict";
import { test } from "node:test";
import { readMediaHydrationError } from "../components/inspector/index";
import {
  ageRatingFillOutcome,
  idsNeedingAgeRatings,
} from "./Discover";

test("age-rating fill skips confirmed misses and surfaces retryable errors", () => {
  const misses = new Set(["tt0000001"]);
  assert.deepEqual(
    idsNeedingAgeRatings(
      [
        { imdbId: "tt0000001" },
        { imdbId: "TT0000002", certification: "PG-13" },
        { imdbId: "tt0000003" },
        { imdbId: "tt0000003" },
      ],
      misses,
    ),
    ["tt0000003"],
  );

  const outcome = ageRatingFillOutcome([
    { id: "tt0000003", certification: "" },
    { id: "tt0000004", certification: "R" },
    {
      id: "tt0000005",
      certification: null,
      error: "TMDb details could not be loaded. Try again.",
    },
    { id: "tt0000006", certification: null },
  ]);
  assert.deepEqual(outcome.misses, ["tt0000003"]);
  assert.equal(outcome.ratings.get("tt0000004"), "R");
  assert.equal(
    outcome.message,
    "TMDb details could not be loaded. Try again.",
  );
  assert.equal(outcome.ratings.has("tt0000005"), false);
  assert.equal(outcome.misses.includes("tt0000005"), false);
  assert.equal(outcome.misses.includes("tt0000006"), false);

  const remembered = new Set(outcome.misses);
  assert.deepEqual(
    idsNeedingAgeRatings(
      [{ imdbId: "tt0000003" }, { imdbId: "tt0000005" }, { imdbId: "tt0000006" }],
      remembered,
    ),
    ["tt0000005", "tt0000006"],
  );
});

test("inspector reads a TMDb hydration error without treating a miss as one", () => {
  assert.equal(readMediaHydrationError(null), null);
  assert.equal(readMediaHydrationError({ overview: "" }), null);
  assert.equal(readMediaHydrationError({ mediaError: "  " }), null);
  assert.equal(
    readMediaHydrationError({
      mediaError: " TMDb details could not be loaded. Try again. ",
    }),
    "TMDb details could not be loaded. Try again.",
  );
});
