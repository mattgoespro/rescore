import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CatalogDatabase } from "../catalog/index.js";
import {
  TMDB_CONCURRENCY,
  TMDB_REQUESTS_PER_SECOND,
  tmdbConcurrency,
  tmdbRequestsPerSecond,
} from "../config.js";
import {
  enrichPosters,
  enrichOneTitle,
  formatEnrichmentProgress,
  MISSING_TMDB_KEY_MESSAGE,
  pickMovieCertification,
  pickTvCertification,
  startPosterEnrichment,
  TmdbClientPool,
  TmdbHydrationCoordinator,
  TmdbRequestScheduler,
} from "./tmdb-posters.js";

afterEach(() => {
  delete process.env.TMDB_API_KEY;
});

test("poster lookups use the bounded shared request budget", () => {
  assert.equal(TMDB_CONCURRENCY, 8);
  assert.equal(TMDB_REQUESTS_PER_SECOND, 40);
  assert.equal(tmdbConcurrency("4"), 4);
  assert.equal(tmdbRequestsPerSecond("12.5"), 12.5);
});

test("poster progress reports the catalogue-wide hydrated count", () => {
  assert.equal(
    formatEnrichmentProgress({
      completedAtStart: 5_200,
      processedThisRun: 500,
      total: 478_751,
      found: 499,
      missing: 1,
      errors: 0,
    }),
    "Progress 5,700/478,751 · found 499 · none 1 · errors 0",
  );
});

test("TMDb client pool rotates healthy keys and isolates a rejected key", () => {
  const pool = new TmdbClientPool(["lane-one", "lane-two"], {
    requestsPerSecond: 40,
    concurrency: 1,
  });
  const first = pool.next();
  const second = pool.next();
  assert.equal(first?.id, "key-1");
  assert.equal(second?.id, "key-2");
  assert.notEqual(first?.scheduler, second?.scheduler);

  pool.disable(first);
  assert.equal(pool.next()?.id, "key-2");
  assert.deepEqual(pool.diagnostics(), [
    {
      id: "key-1",
      disabled: true,
      requests: 0,
      successes: 0,
      rateLimits: 0,
      requestsPerSecond: 40,
    },
    {
      id: "key-2",
      disabled: false,
      requests: 0,
      successes: 0,
      rateLimits: 0,
      requestsPerSecond: 40,
    },
  ]);
});

test("interactive requests join active work and overtake queued background titles", async (t) => {
  const catalog = new CatalogDatabase(":memory:");
  const ids = ["tt0000001", "tt0000002", "tt0000003"];
  catalog.upsertTitles(ids.map((id) => ({ id, title: id, kind: "movie" })));
  const coordinator = new TmdbHydrationCoordinator(["test"], { requestsPerSecond: 1000, concurrency: 1 });
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    const id = input.pathname.split("/").at(-1)!;
    calls.push(id);
    if (id === ids[0]) { started(); await gate; }
    return Response.json({ movie_results: [], tv_results: [] });
  });
  try {
    const first = coordinator.hydrate(catalog, ids[0], "movie", false);
    await firstStarted;
    const second = coordinator.hydrate(catalog, ids[1], "movie", false);
    const third = coordinator.hydrate(catalog, ids[2], "movie", false);
    assert.equal(coordinator.hydrate(catalog, ids[0], "movie", true), first);
    assert.equal(coordinator.hydrate(catalog, ids[2], "movie", true), third);
    release();
    assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]);
    assert.deepEqual(calls, [ids[0], ids[2], ids[1]]);
    assert.equal(catalog.hydrationStats().complete, true, "missing provider values are persisted as resolved");
    const restarted = new TmdbHydrationCoordinator(["test"], { requestsPerSecond: 1000, concurrency: 1 });
    await restarted.hydrate(catalog, ids[0], "movie", false);
    assert.equal(calls.length, 3, "durable completion skips another lookup");
  } finally { release(); catalog.close(); }
});

test("hydration distributes title lookups across configured TMDb keys", async () => {
  const originalFetch = globalThis.fetch;
  const usedKeys: string[] = [];
  globalThis.fetch = async (input) => {
    usedKeys.push(new URL(String(input)).searchParams.get("api_key") ?? "");
    return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const pending = [
    { id: "tt0000001", kind: "movie" },
    { id: "tt0000002", kind: "movie" },
  ];
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles(pending.map((row) => ({ ...row, title: row.id })));

  try {
    await enrichPosters(catalog, {
      apiKeys: ["lane-one", "lane-two"],
      concurrency: 2,
      handleSignals: false,
    });
    assert.deepEqual(usedKeys, ["lane-one", "lane-two"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hydration continues with a healthy TMDb key after another is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const usedKeys: string[] = [];
  globalThis.fetch = async (input) => {
    const key = new URL(String(input)).searchParams.get("api_key") ?? "";
    usedKeys.push(key);
    if (key === "lane-one") return new Response(null, { status: 401 });
    return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const pending = [{ id: "tt0000001", kind: "movie" }];
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles(pending.map((row) => ({ ...row, title: row.id })));

  try {
    await enrichPosters(catalog, {
      apiKeys: ["lane-one", "lane-two"],
      handleSignals: false,
    });
    assert.deepEqual(usedKeys, ["lane-one", "lane-two"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("on-demand enrichment shares the bulk coordinator's rejected-key state", async () => {
  const originalFetch = globalThis.fetch;
  const usedKeys: string[] = [];
  globalThis.fetch = async (input) => {
    const key = new URL(String(input)).searchParams.get("api_key") ?? "";
    usedKeys.push(key);
    if (key === "shared-one") return new Response(null, { status: 401 });
    return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const pending = [{ id: "tt0000001", kind: "movie" }];
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles(pending.map((row) => ({ ...row, title: row.id })));

  try {
    await enrichPosters(catalog, {
      apiKeys: ["shared-one", "shared-two"],
      handleSignals: false,
    });
    catalog.upsertTitles([{ id: "tt0000002", title: "Second", kind: "movie" }]);
    await enrichOneTitle(catalog, "tt0000002", "movie");
    assert.deepEqual(usedKeys, ["shared-one", "shared-two", "shared-two"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails hydration when a certification request cannot complete", async (t) => {
  const originalFetch = globalThis.fetch;
  let certificationFails = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/find/")) {
      return new Response(JSON.stringify({ movie_results: [{ id: 123 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: certificationFails ? 503 : 404 });
  };
  const pending = [{ id: "tt0000001", kind: "movie" }];
  let complete = false;
  let writes = 0;
  const catalog = {
    hydrationStats: () => ({
      total: 1,
      processed: complete ? 1 : 0,
      pending: complete ? 0 : 1,
      complete,
    }),
    titleNeedsMedia: () => !complete,
    titleNeedsLanguages: () => false,
    mediaFor: () => [{ id: "tt0000001", posterUrl: complete ? "" : null }],
    listTitlesNeedingPosters: () => (complete ? [] : pending),
    updatePosterUrlsQueued: async () => {
      writes += 1;
      complete = true;
    },
  } as unknown as CatalogDatabase;

  try {
    await assert.rejects(
      enrichPosters(catalog, {
        apiKeys: ["certification-key"],
        handleSignals: false,
      }),
      /TMDb lookups? failed/,
    );
    assert.equal(writes, 0);
    certificationFails = false;
    const now = Date.now;
    t.mock.method(Date, "now", () => now() + 31_000);
    await enrichPosters(catalog, {
      apiKeys: ["certification-key"],
      handleSignals: false,
    });
    assert.equal(writes, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails hydration after certification rate-limit retries are exhausted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/find/")) {
      return new Response(JSON.stringify({ movie_results: [{ id: 123 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, {
      status: 429,
      headers: { "retry-after": "0" },
    });
  };
  const pending = [{ id: "tt0000001", kind: "movie" }];
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles(pending.map((row) => ({ ...row, title: row.id })));

  try {
    await assert.rejects(
      enrichPosters(catalog, {
        apiKeys: ["rate-limit-key"],
        handleSignals: false,
      }),
      /TMDb lookups? failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shared TMDb scheduler paces requests and honours a rate-limit pause", async () => {
  let now = 0;
  const scheduler = new TmdbRequestScheduler({
    requestsPerSecond: 20,
    concurrency: 2,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
  });
  await scheduler.acquire();
  scheduler.release();
  await scheduler.acquire();
  scheduler.release();
  assert.equal(now, 50);

  scheduler.penalize(1_000, 0);
  await scheduler.acquire();
  scheduler.release();
  assert.equal(now, 1_050);
  assert.equal(scheduler.requestsPerSecond, 10);
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

test("hydration stores original language before other spoken languages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/find/")) {
      return Response.json({
        movie_results: [
          {
            id: 7,
            original_language: "fr",
            poster_path: "/p.jpg",
            overview: "A film.",
          },
        ],
      });
    }
    return Response.json({
      original_language: "fr",
      spoken_languages: [{ iso_639_1: "en" }, { iso_639_1: "fr" }],
      release_dates: { results: [] },
    });
  };
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles([{ id: "tt0000001", title: "Film", kind: "movie" }]);
  try {
    await enrichPosters(catalog, {
      apiKeys: ["language-key"],
      handleSignals: false,
    });
    assert.deepEqual(catalog.title("tt0000001")?.languages, ["fr", "en"]);
  } finally {
    globalThis.fetch = originalFetch;
    catalog.close();
  }
});

test("a finished title receives language details without replacing its poster", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/find/")) {
      return Response.json({
        movie_results: [
          {
            id: 9,
            original_language: "ja",
            poster_path: "/new.jpg",
            overview: "Replacement.",
          },
        ],
      });
    }
    return Response.json({
      original_language: "ja",
      spoken_languages: [{ iso_639_1: "ja" }],
      release_dates: { results: [] },
    });
  };
  const catalog = new CatalogDatabase(":memory:");
  catalog.upsertTitles([{ id: "tt0000001", title: "Film", kind: "movie" }]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://image.tmdb.org/t/p/w500/old.jpg",
      synopsis: "Already here.",
      certification: "PG",
    },
  ]);
  try {
    assert.equal(catalog.titleNeedsMedia("tt0000001"), false);
    assert.equal(catalog.titleNeedsLanguages("tt0000001"), true);
    await enrichOneTitle(catalog, "tt0000001", "movie");
    const title = catalog.title("tt0000001");
    assert.deepEqual(title?.languages, ["ja"]);
    assert.equal(title?.posterUrl, "https://image.tmdb.org/t/p/w500/old.jpg");
    assert.equal(title?.synopsis, "Already here.");
    assert.equal(catalog.titleNeedsLanguages("tt0000001"), false);
  } finally {
    globalThis.fetch = originalFetch;
    catalog.close();
  }
});

test("missing TMDB key is logged once on the posters channel", async () => {
  const previousKeys = process.env.TMDB_API_KEYS;
  process.env.TMDB_API_KEYS = "";
  delete process.env.TMDB_API_KEY;
  delete process.env.APPDATA;
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const catalog = {} as CatalogDatabase;
    await startPosterEnrichment(catalog);
    await startPosterEnrichment(catalog);
  } finally {
    process.stdout.write = original;
    if (previousKeys === undefined) delete process.env.TMDB_API_KEYS;
    else process.env.TMDB_API_KEYS = previousKeys;
  }
  const posterLines = lines.filter(
    (line) =>
      line.includes("posters") && line.includes(MISSING_TMDB_KEY_MESSAGE),
  );
  assert.equal(posterLines.length, 1);
  assert.match(posterLines[0] ?? "", /  posters  posters    info   /);
  assert.doesNotMatch(posterLines[0] ?? "", /stay empty/);
});
