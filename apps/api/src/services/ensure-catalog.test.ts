import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogHealthReady,
  isCatalogUsable,
  publishTmdbHydration,
  progressPhase,
  readTmdbHydration,
  subscribeTmdbHydration,
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

test("catalog is usable after IMDb preparation even while TMDb is incomplete", () => {
  assert.equal(
    isCatalogUsable({ titlesReady: true, creditsReady: true, tmdbReady: true }),
    true,
  );
  assert.equal(
    isCatalogUsable({
      titlesReady: true,
      creditsReady: true,
      tmdbReady: false,
    }),
    true,
  );
  assert.equal(
    isCatalogUsable({
      titlesReady: true,
      creditsReady: false,
      tmdbReady: true,
    }),
    false,
  );
  assert.equal(
    isCatalogUsable({
      titlesReady: true,
      creditsReady: true,
      creditsFailed: true,
      tmdbReady: true,
    }),
    false,
  );
  assert.equal(
    isCatalogUsable({
      titlesReady: false,
      creditsReady: false,
      tmdbReady: false,
    }),
    false,
  );
});

test("health is not ready during a first build or error", () => {
  assert.equal(catalogHealthReady(0, "building", false), false);
  assert.equal(catalogHealthReady(100, "error", true), false);
  assert.equal(catalogHealthReady(0, "idle", false), false);
});

test("TMDb hydration progress stays below complete until durable writes finish", () => {
  publishTmdbHydration({
    processed: 483_433,
    total: 483_433,
    complete: false,
    message: "Writing TMDb records",
  });
  assert.deepEqual(readTmdbHydration(), {
    processed: 483_433,
    total: 483_433,
    percent: 99,
    complete: false,
    message: "Writing TMDb records",
  });
  publishTmdbHydration({
    processed: 483_433,
    total: 483_433,
    complete: true,
    message: "TMDb hydration complete.",
  });
  assert.equal(readTmdbHydration().percent, 100);
  assert.equal(readTmdbHydration().complete, true);
});

test("TMDb hydration subscribers receive durable snapshots and can unsubscribe", () => {
  const snapshots: number[] = [];
  const unsubscribe = subscribeTmdbHydration((progress) => {
    snapshots.push(progress.processed);
  });

  publishTmdbHydration({
    processed: 25,
    total: 100,
    complete: false,
    message: "Writing TMDb records",
  });
  unsubscribe();
  publishTmdbHydration({
    processed: 50,
    total: 100,
    complete: false,
    message: "Writing TMDb records",
  });

  assert.deepEqual(snapshots, [25]);
});
