import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYZE_IDLE_MS } from "./work-queue.js";
import { TITLE_BATCH } from "../build/types.js";

test("title batches and ANALYZE stay off the search path", () => {
  assert.equal(TITLE_BATCH, 500);
  assert.equal(ANALYZE_IDLE_MS, 60_000);
});
