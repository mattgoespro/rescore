import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmdbApiKeys, tmdbMaxConcurrency } from "./config.js";
import { BAKED_TMDB_API_KEYS } from "./tmdb-keys.local.js";

test("parses newline-delimited TMDb keys without duplicates", () => {
  assert.deepEqual(
    tmdbApiKeys(" first-key\nsecond-key\nfirst-key\n", undefined),
    ["first-key", "second-key"],
  );
});

test("uses the legacy key when no key list is configured", () => {
  assert.deepEqual(tmdbApiKeys(undefined, "legacy-key"), ["legacy-key"]);
});

test("uses baked keys when no environment keys are configured", () => {
  assert.deepEqual(
    tmdbApiKeys(undefined, undefined, ["baked-one", "baked-two"]),
    ["baked-one", "baked-two"],
  );
});

test("an empty environment key list overrides baked keys", () => {
  assert.deepEqual(tmdbApiKeys("", undefined, ["baked-one"]), []);
});

test("the build contains two distinct TMDb keys", () => {
  assert.equal(BAKED_TMDB_API_KEYS.length, 2);
  assert.equal(new Set(BAKED_TMDB_API_KEYS).size, 2);
  assert.ok(BAKED_TMDB_API_KEYS.every((key) => key.length > 0));
});

test("baked TMDb keys stay out of source control", () => {
  const ignored = execFileSync("git", ["check-ignore", "tmdb-keys.local.ts"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });
  assert.match(ignored, /tmdb-keys\.local\.ts/);
});

test("caps combined TMDb worker concurrency", () => {
  assert.equal(tmdbMaxConcurrency("12"), 12);
  assert.equal(tmdbMaxConcurrency("0"), 32);
});
