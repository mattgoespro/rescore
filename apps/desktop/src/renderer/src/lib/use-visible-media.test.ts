import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEDIA_FILL_LIMIT,
  clearPendingRetries,
  mediaIdsToFill,
} from "./use-visible-media";

test("poster fill skips resolved ids and ids still inside the retry window", () => {
  const ids = Array.from({ length: 45 }, (_, index) => `tt${index}`);
  const resolved = new Set(["tt0"]);
  const retryAt = new Map([["tt1", 2_000]]);
  const picked = mediaIdsToFill({
    ids,
    resolved,
    retryAt,
    now: 1_000,
    limit: MEDIA_FILL_LIMIT,
  });
  assert.equal(MEDIA_FILL_LIMIT, 40);
  assert.equal(picked.includes("tt0"), false);
  assert.equal(picked.includes("tt1"), false);
  assert.equal(picked.length, 40);
  assert.equal(picked[0], "tt2");

  const pending = new Map([
    ["tt1", 2_000],
    ["tt2", 2_000],
  ]);
  clearPendingRetries(pending, ["tt1", "tt2"], new Set(["tt2"]));
  assert.equal(pending.has("tt1"), false);
  assert.equal(pending.has("tt2"), true);
});
