import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, mock, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { CatalogDatabase } from "../services/catalog-db.js";
import {
  publishTmdbHydration,
  refreshCatalogStatus,
  resetTmdbHydrationForTests,
} from "../services/ensure-catalog.js";
import type { RatingsStore } from "../services/ratings-store.js";
import type { HealthResponse } from "../types.js";
import { healthRouter, resetHealthCatalogCacheForTests } from "./health.js";

function fakeCatalog(): {
  catalog: CatalogDatabase;
  calls: Record<string, number>;
} {
  const calls = {
    titleCount: 0,
    meta: 0,
    readiness: 0,
    update: 0,
    failed: 0,
    posterStats: 0,
    candidates: 0,
  };
  const catalog = {
    titleCount() {
      calls.titleCount += 1;
      return 1_200;
    },
    catalogMeta() {
      calls.meta += 1;
      return {
        builtAt: "2026-09-01T00:00:00.000Z",
        revision: "rev",
        source: "imdb",
      };
    },
    isHealthy() {
      return true;
    },
    readiness() {
      calls.readiness += 1;
      return { titlesReady: true, creditsReady: true };
    },
    titlesUpdateAvailable() {
      calls.update += 1;
      return false;
    },
    creditsFailed() {
      calls.failed += 1;
      return false;
    },
    posterStats() {
      calls.posterStats += 1;
      throw new Error("poster scan");
    },
    listTitlesNeedingPosters() {
      calls.candidates += 1;
      throw new Error("candidate scan");
    },
  };
  return { catalog: catalog as unknown as CatalogDatabase, calls };
}

describe("GET /health TMDb hydration", { concurrency: false }, () => {
  let server: Server;
  let baseUrl = "";
  let calls: Record<string, number> = {};

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    resetTmdbHydrationForTests();
    resetHealthCatalogCacheForTests();
    const fake = fakeCatalog();
    calls = fake.calls;
    refreshCatalogStatus(fake.catalog);
    const app = express();
    app.use(
      "/health",
      healthRouter(
        {
          lastSyncedAt: () => null,
          titleCount: () => 0,
        } as RatingsStore,
        fake.catalog,
      ),
    );
    server = app.listen(0);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    mock.timers.reset();
    resetTmdbHydrationForTests();
    resetHealthCatalogCacheForTests();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test("polls return the in-memory snapshot without scanning titles again", async () => {
    const readinessAfterSetup = calls.readiness;
    const titleCountAfterSetup = calls.titleCount;
    const metaAfterSetup = calls.meta;
    publishTmdbHydration({
      processed: 250,
      total: 1_000,
      message: "Backing off 2s after rate limit",
      complete: false,
    });

    const first = await readHealth(baseUrl);
    assert.equal(first.tmdbHydration.processed, 250);
    assert.equal(first.tmdbHydration.total, 1_000);
    assert.equal(first.tmdbHydration.percent, 25);
    assert.equal(
      first.tmdbHydration.message,
      "Backing off 2s after rate limit",
    );
    assert.equal(first.tmdbHydration.complete, false);

    publishTmdbHydration({
      processed: 500,
      total: 1_000,
      message: "40 requests/s",
      complete: false,
    });
    for (let i = 0; i < 19; i += 1) {
      const body = await readHealth(baseUrl);
      assert.equal(body.tmdbHydration.processed, 500);
      assert.equal(body.tmdbHydration.percent, 50);
      assert.equal(body.tmdbHydration.message, "40 requests/s");
    }

    assert.equal(calls.posterStats, 0);
    assert.equal(calls.candidates, 0);
    assert.equal(calls.readiness, readinessAfterSetup);
    assert.equal(calls.titleCount, titleCountAfterSetup);
    assert.equal(calls.meta, metaAfterSetup + 1);

    publishTmdbHydration({
      processed: 1_000,
      total: 1_000,
      message: "",
      complete: true,
    });
    const done = await readHealth(baseUrl);
    assert.equal(done.tmdbHydration.complete, true);
    assert.equal(done.tmdbHydration.percent, 100);
    assert.equal(calls.readiness, readinessAfterSetup + 1);
    assert.equal(calls.titleCount, titleCountAfterSetup);
    assert.equal(calls.posterStats, 0);
    assert.equal(calls.candidates, 0);
  });
});

async function readHealth(baseUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  return (await response.json()) as HealthResponse;
}
