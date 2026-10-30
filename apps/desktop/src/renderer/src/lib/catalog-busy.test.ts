import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogIndicator,
  catalogLoaderDetail,
  catalogRebuildFeedback,
  isCatalogUiBlocked,
  tmdbHealthPercent,
} from "./catalog-busy";

test("a few filled titles do not display as zero percent", () => {
  const percent = tmdbHealthPercent(25, 483_433);
  assert.equal(percent.label, "<1%");
  assert.ok(percent.width > 0);
  assert.equal(tmdbHealthPercent(0, 483_433).label, "0%");
  assert.equal(tmdbHealthPercent(483_433, 483_433).label, "100%");
});

test("a finished catalog is not blocked", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "ready",
      catalogUsable: true,
    }),
    false,
  );
});

test("a settings rebuild blocks while its titles are unusable", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      catalogUsable: false,
    }),
    true,
  );
});

test("browsing opens while cast and directors are still building", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      catalogUsable: true,
    }),
    false,
  );
});

test("an unusable or unstarted catalog stays blocked", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "ready",
      catalogUsable: false,
    }),
    true,
  );
  assert.equal(isCatalogUiBlocked(null), true);
  assert.equal(
    isCatalogUiBlocked({
      phase: "starting",
    }),
    true,
  );
});

test("catalog errors keep the splash up", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "error",
      catalogUsable: false,
    }),
    true,
  );
});

test("a forced rebuild reports visible in-progress feedback", () => {
  assert.deepEqual(
    catalogRebuildFeedback({
      phase: "building",
      message: "Rebuilding catalog from IMDb datasets…",
    }),
    {
      label: "Rebuilding catalog from IMDb datasets…",
      button: "Rebuilding…",
    },
  );
  assert.equal(
    catalogRebuildFeedback({
      phase: "building",
      message: "   ",
    })?.label,
    "Rebuilding catalog…",
  );
  assert.equal(
    catalogRebuildFeedback({
      phase: "ready",
      message: "Using existing catalog (482,500 titles).",
    }),
    null,
  );
});

test("rebuild feedback is present while the splash blocks the app", () => {
  const status = {
    phase: "building",
    message: "Rebuilding catalog from IMDb datasets…",
    catalogUsable: false,
  };
  assert.equal(isCatalogUiBlocked(status), true);
  assert.equal(
    catalogRebuildFeedback(status)?.label,
    "Rebuilding catalog from IMDb datasets…",
  );
});

test("a blocked rebuild does not have an inline strip", () => {
  const status = {
    phase: "building",
    catalogUsable: false,
    message: "Rebuilding catalog from IMDb datasets…",
  };
  assert.equal(isCatalogUiBlocked(status), true);
  assert.equal(
    catalogRebuildFeedback(status)?.label,
    "Rebuilding catalog from IMDb datasets…",
  );
});

test("loader detail describes the blocking build until bytes arrive", () => {
  assert.equal(
    catalogLoaderDetail({
      phase: "building",
      titlesReady: false,
      titleCount: 0,
    }),
    "IMDb’s non-commercial datasets are several hundred MB. Your ratings, watchlist, and skips are kept.",
  );
  assert.equal(
    catalogLoaderDetail({
      phase: "building",
      titlesReady: true,
      titleCount: 482_500,
      download: { receivedBytes: 12_000 },
    }),
    undefined,
  );
});

test("catalogue indicator names every state in words", () => {
  assert.equal(catalogIndicator(null).label, "Starting");
  assert.equal(
    catalogIndicator({ phase: "building", catalogUsable: false }).state,
    "starting",
  );
  const failed = catalogIndicator({
    phase: "error",
    error: "Service exited",
  });
  assert.equal(failed.label, "Failed");
  assert.equal(failed.tip, "Catalogue has terminated");
  assert.equal(failed.detail, "Service exited");
  const loaded = catalogIndicator({ phase: "ready", catalogUsable: true });
  assert.deepEqual(
    [loaded.state, loaded.label, loaded.tip],
    ["loaded", "Loaded", "Catalogue is running"],
  );
  assert.match(
    catalogIndicator({
      phase: "ready",
      catalogUsable: true,
      tmdbHydration: { complete: false, percent: 40 },
    }).detail,
    /40%/,
  );
});

test("the loaded indicator says when cast and directors are missing", () => {
  assert.match(
    catalogIndicator({
      phase: "building",
      catalogUsable: true,
      creditsReady: false,
    }).detail,
    /still loading/,
  );
  const failed = catalogIndicator({
    phase: "ready",
    catalogUsable: true,
    creditsReady: false,
    creditsFailed: true,
  });
  assert.equal(failed.state, "loaded");
  assert.match(failed.detail, /could not be loaded/);
});

test("the indicator shows setup progress while the title steps run", () => {
  const setup = catalogIndicator({
    phase: "building",
    catalogUsable: false,
    setup: { fraction: 0.564 },
  });
  assert.equal(setup.state, "starting");
  assert.equal(setup.label, "Setting up · 56%");
});
