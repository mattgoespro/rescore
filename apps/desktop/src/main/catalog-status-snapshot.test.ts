import assert from "node:assert/strict";
import { test } from "node:test";
import { isCatalogUiBlocked } from "../renderer/src/lib/catalog-busy";
import type { CatalogStatus } from "../shared/catalog-status";
import { catalogStatusSnapshot } from "./catalog-status-snapshot";

function readyStatus(): CatalogStatus {
  return {
    phase: "ready",
    message: "Using existing catalog (482,500 titles).",
    titleCount: 482_500,
    builtAt: "2026-10-04T00:00:00.000Z",
    error: "previous",
    download: null,
    titlesReady: true,
    creditsReady: true,
    titlesUpdateAvailable: true,
    creditsFailed: false,
    catalogUsable: true,
    tmdbHydration: {
      processed: 1200,
      total: 5000,
      percent: 24,
      complete: false,
      message: "Posters",
    },
  };
}

test("status snapshot keeps counts, flags, and poster hydration", () => {
  const current = readyStatus();
  const next = catalogStatusSnapshot(current, {
    phase: "starting",
    message: "Catalog API stopped; restarting…",
    error: null,
  });
  assert.equal(next.phase, "starting");
  assert.equal(next.message, "Catalog API stopped; restarting…");
  assert.equal(next.error, null);
  assert.equal(next.titleCount, 482_500);
  assert.equal(next.builtAt, current.builtAt);
  assert.equal(next.titlesReady, true);
  assert.equal(next.creditsReady, true);
  assert.equal(next.titlesUpdateAvailable, true);
  assert.equal(next.creditsFailed, false);
  assert.equal(next.catalogUsable, true);
  assert.equal(next.tmdbHydration, current.tmdbHydration);
});

test("status snapshot rebuild stays building and still blocks the shell", () => {
  const next = catalogStatusSnapshot(readyStatus(), {
    phase: "building",
    message: "Rebuilding catalog from IMDb datasets…",
    error: null,
    download: null,
  });
  assert.equal(next.phase, "building");
  assert.equal(next.tmdbHydration?.processed, 1200);
  assert.equal(next.creditsReady, true);
  assert.equal(isCatalogUiBlocked(next), true);
});

test("status snapshot replaces a count that the caller names", () => {
  const next = catalogStatusSnapshot(readyStatus(), {
    phase: "ready",
    message: "Using existing catalog (12 titles).",
    titleCount: 12,
  });
  assert.equal(next.titleCount, 12);
  assert.equal(next.creditsReady, true);
});
