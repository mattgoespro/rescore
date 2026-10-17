import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImdbRatingsCsv, parseRatingDate } from "./csv";

test("IMDb imports normalize rating dates without using CSV order as history", () => {
  const rows = parseImdbRatingsCsv(
    "Const,Your Rating,Date Rated,Title,Title Type\ntt123,8,2024-01-12,Newer,movie\ntt234,9,2012-04-05,Older,movie\n",
  );
  assert.deepEqual(
    rows.map((row) => row.dateRated),
    ["2024-01-12T00:00:00.000Z", "2012-04-05T00:00:00.000Z"],
  );
});

test("invalid and empty rating dates remain unknown", () => {
  for (const value of [
    undefined,
    "",
    "2023-02-29",
    "2024-13-01",
    "yesterday",
  ]) {
    assert.equal(parseRatingDate(value), undefined);
  }
  assert.equal(parseRatingDate("2024-02-29"), "2024-02-29T00:00:00.000Z");
});
