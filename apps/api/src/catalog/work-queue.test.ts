import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { ANALYZE_IDLE_MS } from "./work-queue.js";
import { TITLE_BATCH } from "../build/types.js";

test("title batches and ANALYZE stay off the search path", () => {
  assert.equal(TITLE_BATCH, 500);
  assert.equal(ANALYZE_IDLE_MS, 60_000);
});

test("idle maintenance does not keep a completed process alive", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "const { queueIdleAnalyze } = await import('./src/catalog/work-queue.ts'); void queueIdleAnalyze(() => {}, 60000);",
    ],
    { cwd: process.cwd(), timeout: 3000, encoding: "utf8" },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
});
