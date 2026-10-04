import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverCountLabel } from "./discover-count";

test("an unknown Discover total is not printed as the catalogue size", () => {
  assert.equal(discoverCountLabel(null, false), "");
  assert.equal(discoverCountLabel(null, true), "Searching…");
  assert.equal(discoverCountLabel(0, false), "No titles");
  assert.equal(discoverCountLabel(0, true), "Searching…");
  assert.equal(discoverCountLabel(12, false), "12 titles");
});
