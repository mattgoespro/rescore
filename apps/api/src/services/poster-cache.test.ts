import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { posterEvictions, prunePosterCache } from "./poster-cache.js";

test("nothing is evicted within the cap", () => {
  assert.deepEqual(
    posterEvictions(
      [
        { path: "a", size: 40, mtimeMs: 1 },
        { path: "b", size: 60, mtimeMs: 2 },
      ],
      100,
    ),
    [],
  );
});

test("the oldest images go until the cache is under the prune target", () => {
  const evicted = posterEvictions(
    [
      { path: "new", size: 30, mtimeMs: 30 },
      { path: "old", size: 30, mtimeMs: 10 },
      { path: "mid", size: 30, mtimeMs: 20 },
      { path: "newest", size: 30, mtimeMs: 40 },
    ],
    100,
  );
  // 120 bytes against a cap of 100 clears down to 80: two images go.
  assert.deepEqual(
    evicted.map((file) => file.path),
    ["old", "mid"],
  );
});

test("a prune deletes images with their completion markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "posters-"));
  const sizeDir = join(dir, "w185");
  mkdirSync(sizeDir);
  for (const [name, age] of [
    ["old.jpg", 3000],
    ["new.jpg", 1000],
  ] as const) {
    const path = join(sizeDir, name);
    writeFileSync(path, Buffer.alloc(60));
    writeFileSync(`${path}.complete`, "{}");
    const seconds = Date.now() / 1000 - age;
    utimesSync(path, seconds, seconds);
  }
  assert.equal(await prunePosterCache(dir, 100), 1);
  assert.deepEqual((await readdir(sizeDir)).sort(), [
    "new.jpg",
    "new.jpg.complete",
  ]);
});
