import assert from "node:assert/strict";
import { test } from "node:test";
import { canLoadMoreFromPage } from "./discover-paging.js";

test("a full page with a cursor can load another", () => {
  assert.equal(canLoadMoreFromPage(40, 40, "cursor-value"), true);
});

test("a short page is the end even with a cursor", () => {
  assert.equal(canLoadMoreFromPage(12, 40, "cursor-value"), false);
  assert.equal(canLoadMoreFromPage(0, 40, "cursor-value"), false);
});

test("an exactly full last page does not request page one again", () => {
  assert.equal(canLoadMoreFromPage(40, 40, null), false);
});
