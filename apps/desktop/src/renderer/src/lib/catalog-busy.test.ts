import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogLoaderDetail,
  catalogRebuildFeedback,
  isCatalogUiBlocked,
} from "./catalog-busy";

test("ready catalog with titles is not blocked", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "ready",
      titlesReady: true,
      titleCount: 482_500,
    }),
    false,
  );
});

test("building catalog with existing titles is not blocked", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      titlesReady: true,
      titleCount: 482_500,
    }),
    false,
  );
});

test("first build with no titles is blocked", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      titlesReady: false,
      titleCount: 0,
    }),
    true,
  );
  assert.equal(isCatalogUiBlocked(null), true);
  assert.equal(
    isCatalogUiBlocked({
      phase: "starting",
      titleCount: 0,
    }),
    true,
  );
});

test("catalog errors do not keep the loader up", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "error",
      titleCount: 0,
    }),
    false,
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

test("loader detail distinguishes first build from a background check", () => {
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
    }),
    "Looking for catalogue updates. You can keep using the current titles.",
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
