import assert from "node:assert/strict";
import { test } from "node:test";
import { canLoadMoreFromPage } from "./discover-paging.js";

test("a full page can load another and a short page is the end", () => {
  assert.equal(canLoadMoreFromPage(40, 40), true);
  assert.equal(canLoadMoreFromPage(12, 40), false);
  assert.equal(canLoadMoreFromPage(0, 40), false);
});
