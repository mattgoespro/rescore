import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "../shared/filters";
import { DISCOVER_PAGE_SIZE, discoverQueryParams } from "./discover-slice";

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
