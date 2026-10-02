import assert from "node:assert/strict";
import { test } from "node:test";
import { TmdbRequestScheduler } from "./tmdb-posters.js";
import { cancellableDelay, drainWork, requestShutdown, trackWork } from "./runtime-lifecycle.js";

test("shutdown cancels every queued request and backoff while draining completed work", async () => {
  const scheduler = new TmdbRequestScheduler({ requestsPerSecond: 40, concurrency: 1 });
  await scheduler.acquire();
  const waiters = Array.from({ length: 4 }, () => scheduler.acquire());
  const delay = cancellableDelay(60_000);
  let flushed = false;
  trackWork(new Promise<void>((resolve) => setImmediate(() => { flushed = true; resolve(); })));
  requestShutdown();
  scheduler.release();
  const outcomes = await Promise.allSettled([...waiters, delay]);
  assert.ok(outcomes.every((value) => value.status === "rejected"));
  await drainWork();
  assert.equal(flushed, true);
});
