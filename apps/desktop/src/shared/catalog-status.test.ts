import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCatalogPollSettled,
  normalizeTmdbHydration,
  tmdbHydrationPercent,
} from "./catalog-status";

test("hydration percent reaches 100 only when durable completion is set", () => {
  assert.equal(tmdbHydrationPercent(250, 1_000, false), 25);
  assert.equal(tmdbHydrationPercent(1_000, 1_000, false), 99);
  assert.equal(tmdbHydrationPercent(1_000, 1_000, true), 100);
  assert.equal(
    normalizeTmdbHydration({
      processed: 1_000,
      total: 1_000,
      percent: 100,
      message: "40 requests/s",
      complete: false,
    }).percent,
    99,
  );
});

test("health polling continues until the catalog is ready and TMDb hydration is durable", () => {
  const incomplete = normalizeTmdbHydration({
    processed: 10,
    total: 100,
    message: "Backing off 2s after rate limit",
    complete: false,
  });
  const complete = normalizeTmdbHydration({
    processed: 100,
    total: 100,
    message: "",
    complete: true,
  });
  assert.equal(
    isCatalogPollSettled({ phase: "ready", tmdbHydration: incomplete }),
    false,
  );
  assert.equal(
    isCatalogPollSettled({ phase: "building", tmdbHydration: complete }),
    false,
  );
  assert.equal(
    isCatalogPollSettled({ phase: "ready", tmdbHydration: complete }),
    true,
  );
  assert.equal(
    isCatalogPollSettled({ phase: "error", tmdbHydration: incomplete }),
    true,
  );
});
