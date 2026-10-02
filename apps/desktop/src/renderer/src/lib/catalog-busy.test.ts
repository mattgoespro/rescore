import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

test("a settings rebuild blocks even when titles already exist", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      catalogUsable: true,
    }),
    true,
  );
});

test("titles without credits stay blocked", () => {
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
    catalogUsable: true,
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
