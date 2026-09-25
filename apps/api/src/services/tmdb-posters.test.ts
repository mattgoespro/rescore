import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CatalogDatabase } from "../catalog/index.js";
import {
  TMDB_POSTER_CONCURRENCY,
  TMDB_REQUESTS_PER_SECOND,
  tmdbPosterConcurrency,
  tmdbRequestsPerSecond,
} from "../config.js";
import {
  MISSING_TMDB_KEY_MESSAGE,
  TmdbRequestScheduler,
  parseRetryAfterMs,
  pickMovieCertification,
  pickTvCertification,
  setTmdbSchedulerForTests,
  startPosterEnrichment,
  enrichOneTitle,
} from "./tmdb-posters.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.TMDB_API_KEY;
  delete process.env.CATALOG_REGION;
  globalThis.fetch = originalFetch;
  setTmdbSchedulerForTests(null);
});

test("TMDB lookups default to eight in flight and twenty requests per second", () => {
  assert.equal(TMDB_POSTER_CONCURRENCY, 8);
  assert.equal(TMDB_REQUESTS_PER_SECOND, 20);
  assert.equal(tmdbPosterConcurrency("4"), 4);
  assert.equal(tmdbPosterConcurrency("8.9"), 8);
  assert.equal(tmdbPosterConcurrency("0"), 8);
  assert.equal(tmdbPosterConcurrency("-3"), 1);
  assert.equal(tmdbRequestsPerSecond("12.5"), 12.5);
  assert.equal(tmdbRequestsPerSecond("0"), 20);
  assert.equal(tmdbRequestsPerSecond("0.01"), 0.1);
});

test("Retry-After accepts delta seconds and HTTP dates", () => {
  const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
  assert.equal(parseRetryAfterMs("2", now), 2_000);
  assert.equal(parseRetryAfterMs("1.5", now), 1_500);
  assert.equal(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:02 GMT", now), 2_000);
  assert.equal(parseRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", now), 0);
  assert.equal(parseRetryAfterMs(null, now), null);
  assert.equal(parseRetryAfterMs("soon", now), null);
});

test("the shared scheduler spaces every request on one budget", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 10,
    concurrency: 4,
  });
  await scheduler.acquire();
  await scheduler.acquire();
  await scheduler.acquire();
  assert.equal(clock.nowMs, 200);
  scheduler.release();
  scheduler.release();
  scheduler.release();
  assert.equal(scheduler.inFlightCount, 0);
});

test("the shared scheduler will not exceed its concurrency cap", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 1_000_000,
    concurrency: 2,
  });
  await scheduler.acquire();
  await scheduler.acquire();
  let entered = false;
  const third = scheduler.acquire().then(() => {
    entered = true;
  });
  await Promise.resolve();
  assert.equal(entered, false);
  assert.equal(scheduler.inFlightCount, 2);
  scheduler.release();
  await third;
  assert.equal(entered, true);
  assert.equal(scheduler.inFlightCount, 2);
});

test("429 Retry-After is a minimum and one window cuts the rate once", () => {
  const waits = [0, 0.5, 1].map((sample) => {
    const scheduler = schedulerOn(virtualClock(), {
      requestsPerSecond: 10,
      concurrency: 2,
      random: () => sample,
    });
    const wait = scheduler.penalize(2_000, 0);
    assert.equal(scheduler.requestsPerSecond, 5);
    return wait;
  });
  assert.deepEqual(waits, [2_000, 2_250, 2_500]);

  const scheduler = schedulerOn(virtualClock(), {
    requestsPerSecond: 10,
    concurrency: 2,
  });
  scheduler.penalize(1_000, 0);
  scheduler.penalize(1_000, 1);
  assert.equal(scheduler.requestsPerSecond, 5);
});

test("a missing Retry-After backs off exponentially inside one penalty window", () => {
  const scheduler = schedulerOn(virtualClock(), {
    requestsPerSecond: 10,
    concurrency: 2,
  });
  assert.equal(scheduler.penalize(null, 0), 1_000);
  assert.equal(scheduler.penalize(null, 1), 2_000);
  assert.equal(scheduler.penalize(null, 2), 4_000);
  assert.equal(scheduler.requestsPerSecond, 5);
  assert.equal(
    schedulerOn(virtualClock(), {
      requestsPerSecond: 10,
      concurrency: 1,
    }).penalize(null, 10),
    30_000,
  );
});

test("successful requests restore the budget after the penalty window", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 10,
    concurrency: 4,
  });
  scheduler.penalize(1_000, 0);
  assert.equal(scheduler.requestsPerSecond, 5);
  scheduler.recover();
  assert.equal(scheduler.requestsPerSecond, 5);

  await scheduler.acquire();
  assert.equal(clock.nowMs, 1_000);
  scheduler.release();

  for (let i = 0; i < 3; i += 1) scheduler.recover();
  assert.equal(scheduler.requestsPerSecond, 5);
  scheduler.recover();
  assert.equal(scheduler.requestsPerSecond, 7.5);
  for (let i = 0; i < 4; i += 1) scheduler.recover();
  assert.equal(scheduler.requestsPerSecond, 10);

  await scheduler.acquire();
  const restored = clock.nowMs;
  await scheduler.acquire();
  assert.equal(clock.nowMs - restored, 100);
});

test("find and certification requests share one request budget", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 10,
    concurrency: 4,
  });
  setTmdbSchedulerForTests(scheduler);
  const calls: string[] = [];
  mockFetch(async (url) => {
    calls.push(url);
    if (url.includes("/find/")) {
      return json({
        movie_results: [{ id: 11, poster_path: "/p.jpg", overview: "Plot" }],
      });
    }
    return json({
      results: [
        { iso_3166_1: "US", release_dates: [{ certification: "PG", type: 3 }] },
      ],
    });
  });
  const { catalog, writes } = recordingCatalog();
  await enrichOneTitle(catalog, "tt0000001", "movie");
  await enrichOneTitle(catalog, "tt0000002", "movie");
  assert.equal(calls.filter((url) => url.includes("/find/")).length, 2);
  assert.equal(calls.filter((url) => url.includes("/release_dates")).length, 2);
  assert.equal(clock.nowMs, 300);
  assert.equal(scheduler.inFlightCount, 0);
  assert.equal(writes[0]?.certification, "PG");
  assert.equal(writes[1]?.posterUrl, "https://image.tmdb.org/t/p/w342/p.jpg");
});

test("a 429 waits out Retry-After before the lookup is retried", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 1_000,
    concurrency: 4,
  });
  setTmdbSchedulerForTests(scheduler);
  let finds = 0;
  mockFetch(async (url) => {
    assert.match(url, /\/find\/tt0000009/);
    finds += 1;
    if (finds === 1) {
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "2" },
      });
    }
    return json({ movie_results: [] });
  });
  const { catalog, writes } = recordingCatalog();
  await enrichOneTitle(catalog, "tt0000009", "movie");
  assert.equal(finds, 2);
  assert.equal(clock.nowMs, 2_000);
  assert.equal(scheduler.requestsPerSecond, 500);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    id: "tt0000009",
    posterUrl: null,
    synopsis: null,
    certification: "",
  });
});

test("401 and 403 abort a find without retrying or saving a miss", async () => {
  for (const status of [401, 403]) {
    const clock = virtualClock();
    const scheduler = schedulerOn(clock, {
      requestsPerSecond: 10,
      concurrency: 2,
    });
    setTmdbSchedulerForTests(scheduler);
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response("no", { status });
    });
    const logs: string[] = [];
    const { catalog, writes } = recordingCatalog();
    await withLogs(logs, () => enrichOneTitle(catalog, "tt0000003", "movie"));
    assert.equal(calls, 1);
    assert.equal(writes.length, 0);
    assert.equal(clock.nowMs, 0);
    assert.equal(scheduler.requestsPerSecond, 10);
    assert.match(logs.join("\n"), /TMDB rejected the API key/);
  }
});

test("401 and 403 on certification do not retry and leave the rating unfinished", async () => {
  for (const status of [401, 403]) {
    const scheduler = schedulerOn(virtualClock(), {
      requestsPerSecond: 1_000,
      concurrency: 4,
    });
    setTmdbSchedulerForTests(scheduler);
    const calls: string[] = [];
    mockFetch(async (url) => {
      calls.push(url);
      if (url.includes("/find/")) {
        return json({
          movie_results: [{ id: 4, poster_path: "/x.jpg", overview: "Hello" }],
        });
      }
      return new Response("no", { status });
    });
    const { catalog, writes } = recordingCatalog();
    await enrichOneTitle(catalog, "tt0000004", "movie");
    assert.equal(calls.length, 2);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.posterUrl, "https://image.tmdb.org/t/p/w342/x.jpg");
    assert.equal(writes[0]?.synopsis, "Hello");
    assert.equal(writes[0]?.certification, null);
    assert.equal(scheduler.requestsPerSecond, 1_000);
  }
});

test("a certification 429 retries through the shared scheduler", async () => {
  const clock = virtualClock();
  const scheduler = schedulerOn(clock, {
    requestsPerSecond: 10,
    concurrency: 4,
  });
  setTmdbSchedulerForTests(scheduler);
  let certs = 0;
  const calls: string[] = [];
  mockFetch(async (url) => {
    calls.push(url);
    if (url.includes("/find/")) {
      return json({
        tv_results: [{ id: 8, poster_path: "/tv.jpg", overview: "Series" }],
      });
    }
    certs += 1;
    if (certs === 1) {
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "3" },
      });
    }
    return json({
      results: [{ iso_3166_1: "US", rating: "TV-14" }],
    });
  });
  const { catalog, writes } = recordingCatalog();
  await enrichOneTitle(catalog, "tt0000008", "tv");
  assert.equal(certs, 2);
  assert.equal(
    calls.filter((url) => url.includes("/tv/8/content_ratings")).length,
    2,
  );
  assert.equal(clock.nowMs, 3_100);
  assert.equal(scheduler.requestsPerSecond, 5);
  assert.equal(writes[0]?.certification, "TV-14");
  assert.equal(writes[0]?.posterUrl, "https://image.tmdb.org/t/p/w342/tv.jpg");
  assert.equal(scheduler.inFlightCount, 0);
});

test("a find with no TMDB hit completes as an empty result", async () => {
  setTmdbSchedulerForTests(
    schedulerOn(virtualClock(), { requestsPerSecond: 100, concurrency: 2 }),
  );
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return json({ movie_results: [], tv_results: [] });
  });
  const { catalog, writes } = recordingCatalog();
  await enrichOneTitle(catalog, "tt0000005", "movie");
  assert.equal(calls, 1);
  assert.deepEqual(writes, [
    {
      id: "tt0000005",
      posterUrl: null,
      synopsis: null,
      certification: "",
    },
  ]);
});

test("a hit with no certificate still completes the rating as empty", async () => {
  setTmdbSchedulerForTests(
    schedulerOn(virtualClock(), { requestsPerSecond: 100, concurrency: 2 }),
  );
  mockFetch(async (url) => {
    if (url.includes("/find/")) {
      return json({
        movie_results: [{ id: 9, poster_path: null, overview: "  " }],
      });
    }
    return json({ results: [] });
  });
  const { catalog, writes } = recordingCatalog();
  await enrichOneTitle(catalog, "tt0000006", "movie");
  assert.deepEqual(writes, [
    {
      id: "tt0000006",
      posterUrl: null,
      synopsis: null,
      certification: "",
    },
  ]);
});

test("repeated 429s give up without storing a completed miss", async () => {
  setTmdbSchedulerForTests(
    schedulerOn(virtualClock(), { requestsPerSecond: 100, concurrency: 2 }),
  );
  let calls = 0;
  mockFetch(async () => {
    calls += 1;
    return new Response("{}", { status: 429 });
  });
  const logs: string[] = [];
  const { catalog, writes } = recordingCatalog();
  await withLogs(logs, () => enrichOneTitle(catalog, "tt0000007", "movie"));
  assert.equal(calls, 6);
  assert.equal(writes.length, 0);
  assert.match(logs.join("\n"), /TMDB rate limit exceeded/);
});

test("age rating prefers the configured region, then the US theatrical certificate", () => {
  assert.equal(
    pickMovieCertification(
      {
        results: [
          {
            iso_3166_1: "GB",
            release_dates: [{ certification: "15", type: 3 }],
          },
          {
            iso_3166_1: "US",
            release_dates: [
              { certification: "PG-13", type: 3 },
              { certification: "R", type: 1 },
            ],
          },
        ],
      },
      "US",
    ),
    "PG-13",
  );
  assert.equal(
    pickTvCertification(
      {
        results: [
          { iso_3166_1: "US", rating: "TV-MA" },
          { iso_3166_1: "DE", rating: "16" },
        ],
      },
      "DE",
    ),
    "16",
  );
});

test("missing TMDB key is logged once and does not claim posters stay empty", async () => {
  delete process.env.TMDB_API_KEY;
  delete process.env.APPDATA;
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const catalog = {} as CatalogDatabase;
    await startPosterEnrichment(catalog);
    await startPosterEnrichment(catalog);
  } finally {
    console.log = original;
  }
  const posterLines = lines.filter((line) => line.includes("[posters]"));
  assert.equal(posterLines.length, 1);
  assert.match(posterLines[0] ?? "", new RegExp(MISSING_TMDB_KEY_MESSAGE));
  assert.doesNotMatch(posterLines[0] ?? "", /stay empty/);
});

function virtualClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  nowMs: number;
} {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    get nowMs() {
      return now;
    },
  };
}

function schedulerOn(
  clock: ReturnType<typeof virtualClock>,
  options: {
    requestsPerSecond: number;
    concurrency: number;
    random?: () => number;
  },
): TmdbRequestScheduler {
  return new TmdbRequestScheduler({
    requestsPerSecond: options.requestsPerSecond,
    concurrency: options.concurrency,
    now: clock.now,
    sleep: clock.sleep,
    random: options.random ?? (() => 0),
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string) => Promise<Response>): void {
  process.env.TMDB_API_KEY = "test-key";
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    handler(String(input))) as typeof fetch;
}

function recordingCatalog(): {
  catalog: CatalogDatabase;
  writes: Array<{
    id: string;
    posterUrl?: string | null;
    synopsis?: string | null;
    certification?: string | null;
  }>;
} {
  const writes: Array<{
    id: string;
    posterUrl?: string | null;
    synopsis?: string | null;
    certification?: string | null;
  }> = [];
  const catalog = {
    updatePosterUrls(rows: typeof writes) {
      writes.push(...rows);
    },
  };
  return { catalog: catalog as unknown as CatalogDatabase, writes };
}

async function withLogs(
  logs: string[],
  run: () => Promise<void>,
): Promise<void> {
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
}
