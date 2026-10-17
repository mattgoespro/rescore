import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogDatabase } from "../catalog/index.js";
import { TmdbHydrationCoordinator } from "./tmdb-posters.js";
import {
  METADATA_RETRY_INTERVAL_MS,
  METADATA_RETRY_POLL_MS,
  runMetadataRetries,
} from "./metadata-retries.js";

test("periodic retries discover newly available metadata and keep misses on cooldown", async (t) => {
  const catalog = new CatalogDatabase(":memory:");
  const controller = new AbortController();
  let time = METADATA_RETRY_INTERVAL_MS;
  catalog.upsertTitles([
    { id: "tt0000001", title: "Initially missing", kind: "movie" },
  ]);
  const coordinator = new TmdbHydrationCoordinator(["test"], {
    concurrency: 1,
    requestsPerSecond: 1000,
  });
  // The request scheduler uses real time; only persisted retry ages advance by days.
  t.mock.method(Date, "now", () => time);
  let found = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    calls++;
    if (input.pathname.includes("/find/"))
      return Response.json({
        movie_results: found
          ? [{ id: 1, poster_path: "/new.jpg", overview: "Now available" }]
          : [],
      });
    return Response.json({ original_language: "en" });
  });
  try {
    await coordinator.hydrate(catalog, "tt0000001", "movie", false);
    assert.equal(catalog.titleNeedsMedia("tt0000001"), false);
    const cycles: string[][] = [];
    let ticks = 0;
    await runMetadataRetries(
      catalog,
      async (ids) => {
        cycles.push(ids);
        for (const id of ids)
          await coordinator.hydrate(catalog, id, "movie", false);
      },
      () => true,
      {
        signal: controller.signal,
        now: () => time,
        wait: async (delay) => {
          assert.equal(delay, METADATA_RETRY_POLL_MS);
          ticks++;
          if (ticks === 1) time += METADATA_RETRY_INTERVAL_MS - 1;
          if (ticks === 2) time += 1; // Due: still missing, so the cooldown restarts.
          if (ticks === 3) {
            time += 1;
            found = true;
          }
          if (ticks === 4) time += METADATA_RETRY_INTERVAL_MS;
          if (ticks === 5) controller.abort();
        },
      },
    );
    assert.deepEqual(cycles, [["tt0000001"], ["tt0000001"]]);
    assert.equal(calls, 4, "initial miss, retried miss, then find and details");
    assert.equal(catalog.title("tt0000001")?.synopsis, "Now available");
    assert.match(catalog.title("tt0000001")?.posterUrl ?? "", /new.jpg$/);
    assert.equal(catalog.hydrationStats().complete, true);
  } finally {
    catalog.close();
  }
});

test("retry loop waits for active catalogue work and cancels without requeueing", async () => {
  const catalog = new CatalogDatabase(":memory:");
  const controller = new AbortController();
  catalog.upsertTitles([
    {
      id: "tt0000001",
      title: "Legacy",
      kind: "movie",
      posterUrl: "",
      synopsis: "",
    },
  ]);
  catalog.updatePosterUrls([
    { id: "tt0000001", certification: "", languages: [] },
  ]);
  let ticks = 0;
  let hydrationCalls = 0;
  try {
    await runMetadataRetries(
      catalog,
      async () => {
        hydrationCalls++;
      },
      () => false,
      {
        signal: controller.signal,
        wait: async () => {
          if (++ticks === 2) {
            controller.abort();
            throw new Error("stopping");
          }
        },
      },
    );
    assert.equal(ticks, 2);
    assert.equal(hydrationCalls, 0);
    assert.equal(catalog.hydrationStats().complete, true);
  } finally {
    catalog.close();
  }
});
