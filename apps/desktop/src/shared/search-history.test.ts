import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "./filters";
import {
  isDefaultSearchHistory,
  shouldRecordSearchHistory,
  snapshotSearchHistory,
} from "./search-history";

test("non-default filters are recordable immediately", () => {
  const snapshot = snapshotSearchHistory(
    { ...defaultFilters(), sortBy: "vote_average.desc", genres: [18] },
    [{ id: 18, name: "Drama" }],
  );
  assert.equal(isDefaultSearchHistory(snapshot), false);
  assert.equal(shouldRecordSearchHistory({ saved: false, snapshot }), true);
});

test("default filters are not recorded", () => {
  const snapshot = snapshotSearchHistory(defaultFilters(), []);
  assert.equal(isDefaultSearchHistory(snapshot), true);
  assert.equal(shouldRecordSearchHistory({ saved: false, snapshot }), false);
});

test("already-saved sessions are not recorded again", () => {
  const snapshot = snapshotSearchHistory(
    { ...defaultFilters(), sortBy: "vote_average.desc" },
    [],
  );
  assert.equal(shouldRecordSearchHistory({ saved: true, snapshot }), false);
});
