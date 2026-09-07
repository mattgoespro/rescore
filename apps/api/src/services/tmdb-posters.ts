import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TMDB_API_BASE,
  TMDB_IMAGE_BASE,
  TMDB_POSTER_CONCURRENCY,
  TMDB_POSTER_PAGE_SIZE,
} from "../config.js";
import type { CatalogDatabase } from "./catalog-db.js";

interface FindHit {
  poster_path?: string | null;
  overview?: string | null;
}

interface FindResponse {
  movie_results?: FindHit[];
  tv_results?: FindHit[];
}

interface TitleMedia {
  posterUrl: string | null;
  synopsis: string | null;
}

export interface PosterEnrichmentResult {
  processed: number;
  found: number;
  missing: number;
  errors: number;
}

export async function enrichPosters(
  catalog: CatalogDatabase,
  options: {
    apiKey?: string;
    concurrency?: number;
    handleSignals?: boolean;
    pageSize?: number;
  } = {},
): Promise<PosterEnrichmentResult> {
  const apiKey = options.apiKey ?? readTmdbApiKey();
  const concurrency = options.concurrency ?? TMDB_POSTER_CONCURRENCY;
  const pageSize = options.pageSize ?? TMDB_POSTER_PAGE_SIZE;
  const pendingTotal = catalog.posterStats().pending ?? 0;
  const stats: PosterEnrichmentResult = {
    processed: 0,
    found: 0,
    missing: 0,
    errors: 0,
  };
  if (!pendingTotal) {
    log("No titles left without a poster lookup");
    return stats;
  }

  log(
    `Looking up TMDB posters for ${pendingTotal.toLocaleString()} titles (${concurrency} workers, background)`,
  );

  let stop = false;
  const onInterrupt = (): void => {
    log("Interrupt received; flushing poster writes");
    stop = true;
  };
  if (options.handleSignals !== false) {
    process.once("SIGINT", onInterrupt);
  }

  while (!stop) {
    const pending = catalog.listTitlesNeedingPosters(pageSize, drainPriorityIds());
    if (!pending.length) break;
    await enrichPage(catalog, apiKey, pending, concurrency, stats, pendingTotal, () => stop);
    await yieldEventLoop();
  }

  log(
    `Stopped after ${stats.processed.toLocaleString()} lookups (${stats.found.toLocaleString()} posters saved)`,
  );
  return stats;
}

async function enrichPage(
  catalog: CatalogDatabase,
  apiKey: string,
  pending: Array<{ id: string; kind: string }>,
  concurrency: number,
  stats: PosterEnrichmentResult,
  pendingTotal: number,
  shouldStop: () => boolean,
): Promise<void> {
  let cursor = 0;
  let batch: Array<{ id: string; posterUrl: string | null; synopsis: string | null }> = [];
  const flush = (): void => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    void catalog.updatePosterUrlsQueued(rows);
  };

  const workers = Array.from(
    { length: Math.min(concurrency, pending.length) },
    async () => {
      while (!shouldStop()) {
        const index = cursor++;
        if (index >= pending.length) return;
        const title = pending[index];
        try {
          const media = await findTitleMedia(apiKey, title.id, title.kind);
          batch.push({ id: title.id, ...media });
          if (media.posterUrl) stats.found += 1;
          else stats.missing += 1;
        } catch (error) {
          stats.errors += 1;
          log(
            `Failed ${title.id}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
        stats.processed += 1;
        if (batch.length >= 25) flush();
        if (stats.processed % 250 === 0) {
          log(
            `Progress ${stats.processed.toLocaleString()}/${pendingTotal.toLocaleString()} · found ${stats.found.toLocaleString()} · none ${stats.missing.toLocaleString()} · errors ${stats.errors}`,
          );
        }
        await yieldEventLoop();
      }
    },
  );

  await Promise.all(workers);
  flush();
}

async function findTitleMedia(
  apiKey: string,
  imdbId: string,
  kind: string,
): Promise<TitleMedia> {
  const url = new URL(`${TMDB_API_BASE}/find/${encodeURIComponent(imdbId)}`);
  url.searchParams.set("external_source", "imdb_id");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "en-US");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep((Number.isFinite(retryAfter) ? retryAfter : 1 + attempt) * 1000);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("TMDB rejected the API key");
    }
    if (!response.ok) {
      lastError = new Error(`TMDB find failed (${response.status})`);
      await sleep(300 * (attempt + 1));
      continue;
    }
    const data = (await response.json()) as FindResponse;
    const preferred =
      kind === "tv" || kind === "miniseries"
        ? [...(data.tv_results ?? []), ...(data.movie_results ?? [])]
        : [...(data.movie_results ?? []), ...(data.tv_results ?? [])];
    const hit =
      preferred.find((item) => item.poster_path || item.overview?.trim()) ??
      preferred[0];
    const overview = hit?.overview?.trim() || null;
    return {
      posterUrl: hit?.poster_path ? `${TMDB_IMAGE_BASE}${hit.poster_path}` : null,
      synopsis: overview,
    };
  }
  throw lastError ?? new Error("TMDB rate limit exceeded");
}

export async function enrichOneTitle(
  catalog: CatalogDatabase,
  id: string,
  kind: string,
): Promise<void> {
  const apiKey = tryReadTmdbApiKey();
  if (!apiKey) return;
  try {
    const media = await findTitleMedia(apiKey, id, kind);
    catalog.updatePosterUrls([{ id, ...media }]);
  } catch (error) {
    log(`Failed ${id}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export function tryReadTmdbApiKey(): string | null {
  try {
    return readTmdbApiKey();
  } catch {
    return null;
  }
}

export function readTmdbApiKey(): string {
  const fromEnv = process.env.TMDB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const appData = process.env.APPDATA;
  if (appData) {
    const file = join(appData, "imdbrain", "imdbrain.json");
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        settings?: { tmdbApiKey?: string };
      };
      const key = raw.settings?.tmdbApiKey?.trim();
      if (key) return key;
    }
  }
  throw new Error(
    "Set TMDB_API_KEY, or keep a TMDB key in the desktop app settings file.",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function drainPriorityIds(): string[] {
  const ids = priorityIds.splice(0, priorityIds.length);
  return ids;
}

function log(message: string): void {
  console.log(`[posters] ${message}`);
}

let posterInflight: Promise<PosterEnrichmentResult | null> | null = null;
const priorityIds: string[] = [];

export function prioritizePosterIds(ids: string[]): void {
  for (const id of ids) {
    const key = id.toLowerCase();
    if (!key || priorityIds.includes(key)) continue;
    priorityIds.unshift(key);
  }
}

export function isPosterEnrichmentRunning(): boolean {
  return posterInflight != null;
}

export function startPosterEnrichment(
  catalog: CatalogDatabase,
  options: { ids?: string[] } = {},
): Promise<PosterEnrichmentResult | null> {
  if (options.ids?.length) prioritizePosterIds(options.ids);
  if (posterInflight) return posterInflight;
  const apiKey = tryReadTmdbApiKey();
  if (!apiKey) {
    log("No TMDB API key; posters stay empty until you add one in Settings.");
    return Promise.resolve(null);
  }
  posterInflight = enrichPosters(catalog, {
    apiKey,
    handleSignals: false,
  })
    .catch((error: unknown) => {
      log(`Poster lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    })
    .finally(() => {
      posterInflight = null;
    });
  return posterInflight;
}
