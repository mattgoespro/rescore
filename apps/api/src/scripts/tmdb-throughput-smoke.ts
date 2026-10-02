import { CATALOG_DB_PATH, TMDB_API_BASE } from "../config.js";
import { CatalogDatabase } from "../services/catalog-db.js";
import {
  compareTmdbKeyPoolThroughput,
  compareTmdbThroughput,
  summarizeTmdbThroughput,
  type TmdbThroughputSample,
  type TmdbThroughputResult,
} from "../services/tmdb-throughput.js";
import {
  readTmdbApiKeys,
  TmdbRequestScheduler,
} from "../services/tmdb-posters.js";

const CAPS = [20, 30, 40];
const SAMPLE_SIZE = Math.max(
  20,
  Number(process.env.TMDB_SMOKE_SAMPLES_PER_CAP) || 120,
);
const MAX_RATE_LIMITS = 3;

interface MultiKeyRun {
  capPerKey: number;
  individual: Array<TmdbThroughputResult & { lane: string }>;
  combined: TmdbThroughputResult;
  comparison: ReturnType<typeof compareTmdbKeyPoolThroughput>;
}

if (process.env.TMDB_SMOKE_CONFIRM !== "1") {
  throw new Error(
    "This sends live TMDb requests. Re-run with TMDB_SMOKE_CONFIRM=1.",
  );
}

const catalog = new CatalogDatabase(CATALOG_DB_PATH);

try {
  const apiKeys = readTmdbApiKeys();
  const ids = catalog
    .listTitles({
      page: 1,
      pageSize: 30,
      sort: "votes",
      order: "desc",
      includeTotal: false,
    })
    .data.map((title) => title.id);
  if (!ids.length) {
    throw new Error("No catalogue titles are available for the smoke test.");
  }

  const results: MultiKeyRun[] = [];
  for (const cap of CAPS) {
    const individual = [];
    for (const apiKey of apiKeys) {
      individual.push(await runCap(cap, ids, apiKey));
    }
    const combined = await runCombinedCap(cap, ids, apiKeys);
    results.push({
      capPerKey: cap,
      individual: individual.map((result, index) => ({
        lane: `key-${index + 1}`,
        ...result,
      })),
      combined,
      comparison: compareTmdbKeyPoolThroughput({
        capPerKey: cap,
        individual,
        combined,
      }),
    });
  }

  console.log(
    JSON.stringify(
      {
        samplesPerCap: SAMPLE_SIZE,
        maxRateLimitsPerCap: MAX_RATE_LIMITS,
        singleKeyCaps: apiKeys.map((_, index) => ({
          lane: `key-${index + 1}`,
          results: compareTmdbThroughput(
            results.map((result) => {
              const { lane: _lane, ...throughput } = result.individual[index];
              return throughput;
            }),
          ),
        })),
        multiKeyRuns: results,
      },
      null,
      2,
    ),
  );
} finally {
  catalog.close();
}

async function runCap(cap: number, ids: string[], apiKey: string) {
  const startedAt = performance.now();
  const samples = await runLane(cap, ids, apiKey);
  return summarizeTmdbThroughput({
    cap,
    elapsedMs: performance.now() - startedAt,
    samples,
  });
}

async function runCombinedCap(cap: number, ids: string[], apiKeys: string[]) {
  const startedAt = performance.now();
  const lanes = await Promise.all(
    apiKeys.map((apiKey) => runLane(cap, ids, apiKey)),
  );
  return summarizeTmdbThroughput({
    cap: cap * apiKeys.length,
    elapsedMs: performance.now() - startedAt,
    samples: lanes.flat(),
  });
}

async function runLane(
  cap: number,
  ids: string[],
  apiKey: string,
): Promise<TmdbThroughputSample[]> {
  const scheduler = new TmdbRequestScheduler({
    requestsPerSecond: cap,
    concurrency: Math.min(16, cap),
  });
  const samples: TmdbThroughputSample[] = [];
  let cursor = 0;
  let rateLimits = 0;
  const workers = Array.from(
    { length: Math.min(16, SAMPLE_SIZE) },
    async () => {
      while (rateLimits < MAX_RATE_LIMITS) {
        const index = cursor++;
        if (index >= SAMPLE_SIZE) return;
        const id = ids[index % ids.length];
        if (!id) return;
        await scheduler.acquire();
        const requestStartedAt = performance.now();
        let status = 0;
        try {
          const url = new URL(
            `${TMDB_API_BASE}/find/${encodeURIComponent(id)}`,
          );
          url.searchParams.set("external_source", "imdb_id");
          url.searchParams.set("api_key", apiKey);
          url.searchParams.set("language", "en-US");
          const response = await fetch(url, {
            headers: { Accept: "application/json" },
          });
          status = response.status;
          if (status === 429) rateLimits += 1;
          await response.body?.cancel();
        } catch {
          status = 0;
        } finally {
          scheduler.release();
        }
        samples.push({
          status,
          latencyMs: performance.now() - requestStartedAt,
        });
      }
    },
  );
  await Promise.all(workers);
  return samples;
}
