import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogHealthReady,
  progressPhase,
  publishTmdbHydration,
  readTmdbHydration,
  resetTmdbHydrationForTests,
  tmdbHydrationPercent,
} from "./ensure-catalog.js";

test("usable catalog stays ready during dump checks", () => {
  assert.equal(progressPhase(true), "ready");
  assert.equal(progressPhase(true, false), "ready");
});

test("empty or forced catalogs still report building", () => {
  assert.equal(progressPhase(false), "building");
  assert.equal(progressPhase(true, true), "building");
});

test("health stays ready when titles exist even if a check is in flight", () => {
  assert.equal(catalogHealthReady(482_500, "ready", true), true);
  assert.equal(catalogHealthReady(482_500, "building", true), true);
});

test("health is not ready during a first build or error", () => {
  assert.equal(catalogHealthReady(0, "building", false), false);
  assert.equal(catalogHealthReady(100, "error", true), false);
  assert.equal(catalogHealthReady(0, "idle", false), false);
});

test("TMDb hydration percent stays under 100 until the durable flag is set", () => {
  assert.equal(tmdbHydrationPercent(0, 1_000, false), 0);
  assert.equal(tmdbHydrationPercent(250, 1_000, false), 25);
  assert.equal(tmdbHydrationPercent(1_000, 1_000, false), 99);
  assert.equal(tmdbHydrationPercent(1_000, 1_000, true), 100);
});

test("publishing TMDb hydration updates an in-memory snapshot", () => {
  resetTmdbHydrationForTests();
  const published = publishTmdbHydration({
    processed: 250,
    total: 1_000,
    message: "  Backing off 2s after rate limit  ",
    complete: false,
  });
  assert.deepEqual(published, {
    processed: 250,
    total: 1_000,
    percent: 25,
    message: "Backing off 2s after rate limit",
    complete: false,
  });
  published.processed = 999;
  assert.equal(readTmdbHydration().processed, 250);
  assert.equal(
    publishTmdbHydration({
      processed: 1_000,
      total: 1_000,
      message: "40 requests/s",
      complete: true,
    }).percent,
    100,
  );
  resetTmdbHydrationForTests();
});
