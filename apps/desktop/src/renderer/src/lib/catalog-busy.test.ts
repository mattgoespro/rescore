import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogHydrationLabel,
  catalogLoaderDetail,
  catalogRebuildFeedback,
  isCatalogUiBlocked,
  tmdbHydrationCaption,
  visibleTmdbHydration,
} from "./catalog-busy";
import { normalizeTmdbHydration } from "../../../shared/catalog-status";

const durable = normalizeTmdbHydration({
  processed: 482_500,
  total: 482_500,
  complete: true,
  message: "",
});

test("ready catalog with titles is not blocked once TMDb hydration is durable", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "ready",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: durable,
    }),
    false,
  );
});

test("building catalog with existing titles stays open after TMDb hydration is durable", () => {
  assert.equal(
    isCatalogUiBlocked({
      phase: "building",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: durable,
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

test("rebuild feedback stays available when existing titles keep the app unlocked", () => {
  const status = {
    phase: "building",
    message: "Rebuilding catalog from IMDb datasets…",
    titlesReady: true,
    titleCount: 482_500,
    tmdbHydration: durable,
  };
  assert.equal(isCatalogUiBlocked(status), false);
  assert.equal(
    catalogRebuildFeedback(status)?.label,
    "Rebuilding catalog from IMDb datasets…",
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
      tmdbHydration: durable,
    }),
    "Looking for catalogue updates. You can keep using the current titles.",
  );
  assert.equal(
    catalogLoaderDetail({
      phase: "building",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: durable,
      download: { receivedBytes: 12_000 },
    }),
    undefined,
  );
});

test("titles stay blocked until TMDb hydration is durably complete", () => {
  const inFlight = normalizeTmdbHydration({
    processed: 1_000,
    total: 1_000,
    complete: false,
    message: "Flushing durable TMDb writes…",
  });
  assert.equal(inFlight.percent, 99);
  assert.equal(
    isCatalogUiBlocked({
      phase: "ready",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: inFlight,
    }),
    true,
  );
  assert.equal(
    catalogHydrationLabel({
      phase: "ready",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: inFlight,
    }),
    "Hydrating TMDb records…",
  );
  assert.equal(
    catalogLoaderDetail({
      phase: "ready",
      titlesReady: true,
      titleCount: 482_500,
      tmdbHydration: inFlight,
    }),
    "Flushing durable TMDb writes…",
  );
});

test("hydration caption shows percent, processed, and total", () => {
  const progress = normalizeTmdbHydration({
    processed: 250,
    total: 1_000,
    complete: false,
    message: "40 requests/s",
  });
  assert.equal(progress.percent, 25);
  assert.equal(tmdbHydrationCaption(progress), "25% · 250 / 1,000");
  assert.equal(visibleTmdbHydration(progress)?.message, "40 requests/s");
  assert.equal(visibleTmdbHydration(durable), null);
  assert.equal(
    visibleTmdbHydration(
      normalizeTmdbHydration({
        processed: 0,
        total: 0,
        complete: false,
        message: "",
      }),
    ),
    null,
  );
});
