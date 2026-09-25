import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TMDB_API_BASE,
  TMDB_IMAGE_BASE,
  TMDB_POSTER_CONCURRENCY,
  TMDB_POSTER_PAGE_SIZE,
  TMDB_REQUESTS_PER_SECOND,
} from "../config.js";
import type { CatalogDatabase } from "./catalog-db.js";

const RATE_LIMIT_BACKOFF_CAP_MS = 30_000;
const RATE_LIMIT_JITTER = 0.25;
const RATE_RECOVERY_SUCCESSES = 4;
const RATE_RECOVERY_STEP = 0.25;

export interface TmdbSchedulerOptions {
  requestsPerSecond: number;
  concurrency: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class TmdbRequestScheduler {
  private readonly budgetRps: number;
  private readonly concurrency: number;
  private readonly minimumRps: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private currentRps: number;
  private inFlight = 0;
  private nextAllowedAt = 0;
  private blockedUntil = 0;
  private successesSincePenalty = 0;
  private readonly slotWaiters: Array<() => void> = [];

  constructor(options: TmdbSchedulerOptions) {
    if (
      !(options.requestsPerSecond > 0) ||
      !Number.isFinite(options.requestsPerSecond)
    ) {
      throw new Error("requestsPerSecond must be a positive number");
    }
    if (!(options.concurrency >= 1) || !Number.isFinite(options.concurrency)) {
      throw new Error("concurrency must be at least 1");
    }
    this.budgetRps = options.requestsPerSecond;
    this.currentRps = options.requestsPerSecond;
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.minimumRps = Math.min(1, options.requestsPerSecond);
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  get requestsPerSecond(): number {
    return this.currentRps;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  async acquire(): Promise<void> {
    for (;;) {
      if (this.inFlight >= this.concurrency) {
        await this.waitForSlot();
        continue;
      }
      const waitMs =
        Math.max(this.nextAllowedAt, this.blockedUntil) - this.now();
      if (waitMs > 0) {
        await this.sleep(waitMs);
        continue;
      }
      this.inFlight += 1;
      this.nextAllowedAt = this.now() + this.spacingMs();
      return;
    }
  }

  release(): void {
    if (this.inFlight === 0) return;
    this.inFlight -= 1;
    this.slotWaiters.shift()?.();
  }

  penalize(retryAfterMs: number | null, attempt = 0): number {
    const base =
      retryAfterMs == null
        ? Math.min(RATE_LIMIT_BACKOFF_CAP_MS, 1_000 * 2 ** Math.max(0, attempt))
        : Math.max(0, retryAfterMs);
    const wait =
      base + Math.floor(base * RATE_LIMIT_JITTER * this.unitRandom());
    const until = this.now() + wait;
    const alreadyPenalized = this.now() < this.blockedUntil;
    this.blockedUntil = Math.max(this.blockedUntil, until);
    if (!alreadyPenalized) {
      this.currentRps = Math.max(this.minimumRps, this.currentRps / 2);
      this.successesSincePenalty = 0;
      this.nextAllowedAt = Math.max(
        this.nextAllowedAt,
        this.blockedUntil,
        this.now() + this.spacingMs(),
      );
    }
    return wait;
  }

  recover(): void {
    if (this.now() < this.blockedUntil) return;
    if (this.currentRps >= this.budgetRps) {
      this.currentRps = this.budgetRps;
      return;
    }
    this.successesSincePenalty += 1;
    if (this.successesSincePenalty < RATE_RECOVERY_SUCCESSES) return;
    this.successesSincePenalty = 0;
    this.currentRps = Math.min(
      this.budgetRps,
      this.currentRps + this.budgetRps * RATE_RECOVERY_STEP,
    );
  }

  private spacingMs(): number {
    return 1_000 / this.currentRps;
  }

  private unitRandom(): number {
    const value = this.random();
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  private waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      this.slotWaiters.push(resolve);
    });
  }
}

let schedulerOverride: TmdbRequestScheduler | null = null;
let sharedScheduler: TmdbRequestScheduler | null = null;

function getTmdbScheduler(): TmdbRequestScheduler {
  if (schedulerOverride) return schedulerOverride;
  sharedScheduler ??= new TmdbRequestScheduler({
    requestsPerSecond: TMDB_REQUESTS_PER_SECOND,
    concurrency: TMDB_POSTER_CONCURRENCY,
  });
  return sharedScheduler;
}

export function setTmdbSchedulerForTests(
  scheduler: TmdbRequestScheduler | null,
): void {
  schedulerOverride = scheduler;
}

export function parseRetryAfterMs(
  header: string | null,
  nowMs: number,
): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const dated = Date.parse(trimmed);
  if (Number.isNaN(dated)) return null;
  return Math.max(0, dated - nowMs);
}

interface FindHit {
  id?: number;
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
  certification: string | null;
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
    `Looking up TMDB posters for ${pendingTotal.toLocaleString()} titles (${concurrency} workers, ${TMDB_REQUESTS_PER_SECOND} req/s, background)`,
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
    const pending = catalog.listTitlesNeedingPosters(
      pageSize,
      drainPriorityIds(),
      false,
    );
    if (!pending.length) break;
    await enrichPage(
      catalog,
      apiKey,
      pending,
      concurrency,
      stats,
      pendingTotal,
      () => stop,
    );
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
  let batch: Array<{
    id: string;
    posterUrl: string | null;
    synopsis: string | null;
    certification: string | null;
  }> = [];
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

export async function fillTitles(
  catalog: CatalogDatabase,
  ids: string[],
): Promise<
  Array<{
    id: string;
    synopsis: string | null;
    posterUrl: string | null;
    certification: string | null;
  }>
> {
  const rows = catalog.mediaFor(ids).slice(0, 40);
  const pending = rows.filter(
    (row) =>
      row.posterUrl == null ||
      row.synopsis == null ||
      row.certification == null,
  );
  const apiKey = tryReadTmdbApiKey();
  if (apiKey && pending.length) {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(4, pending.length) },
      async () => {
        while (cursor < pending.length) {
          const row = pending[cursor];
          cursor += 1;
          if (!row) return;
          await enrichOneTitle(catalog, row.id, row.kind);
        }
      },
    );
    await Promise.all(workers);
  }
  return catalog.mediaFor(rows.map((row) => row.id)).map((row) => ({
    id: row.id,
    synopsis: row.synopsis,
    posterUrl: row.posterUrl,
    certification: row.certification,
  }));
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
    const response = await scheduledTmdbFetch(url);
    if (response.status === 429) {
      noteTmdbRateLimit(response, attempt);
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
    noteTmdbSuccess();
    const data = (await response.json()) as FindResponse;
    const preferred =
      kind === "tv" || kind === "miniseries"
        ? [...(data.tv_results ?? []), ...(data.movie_results ?? [])]
        : [...(data.movie_results ?? []), ...(data.tv_results ?? [])];
    const hit =
      preferred.find((item) => item.poster_path || item.overview?.trim()) ??
      preferred[0];
    const overview = hit?.overview?.trim() || null;
    const certification = hit?.id
      ? await readCertification(apiKey, hit.id, kind)
      : "";
    return {
      posterUrl: hit?.poster_path
        ? `${TMDB_IMAGE_BASE}${hit.poster_path}`
        : null,
      synopsis: overview,
      certification,
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
    log(
      `Failed ${id}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

async function readCertification(
  apiKey: string,
  tmdbId: number,
  kind: string,
): Promise<string | null> {
  const tv = kind === "tv" || kind === "miniseries";
  const url = new URL(
    `${TMDB_API_BASE}${tv ? `/tv/${tmdbId}/content_ratings` : `/movie/${tmdbId}/release_dates`}`,
  );
  url.searchParams.set("api_key", apiKey);
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await scheduledTmdbFetch(url);
    if (response.status === 429) {
      noteTmdbRateLimit(response, attempt);
      continue;
    }
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) return null;
    noteTmdbSuccess();
    const data = (await response.json()) as ReleaseDates | ContentRatings;
    const region = (process.env.CATALOG_REGION || "US").toUpperCase();
    return tv
      ? pickTvCertification(data as ContentRatings, region)
      : pickMovieCertification(data as ReleaseDates, region);
  }
  return null;
}

interface ReleaseDate {
  certification?: string;
  type?: number;
}
interface ReleaseDates {
  results?: Array<{ iso_3166_1?: string; release_dates?: ReleaseDate[] }>;
}
interface ContentRatings {
  results?: Array<{ iso_3166_1?: string; rating?: string }>;
}

export function pickMovieCertification(
  data: ReleaseDates | undefined,
  region: string,
): string {
  const groups = data?.results ?? [];
  const wanted = (region || "US").toUpperCase();
  const ordered = [
    ...groups.filter((group) => group.iso_3166_1 === wanted),
    ...(wanted !== "US"
      ? groups.filter((group) => group.iso_3166_1 === "US")
      : []),
    ...groups.filter(
      (group) => group.iso_3166_1 !== wanted && group.iso_3166_1 !== "US",
    ),
  ];
  for (const group of ordered) {
    const dates = group.release_dates ?? [];
    const theatrical = dates.find(
      (entry) =>
        (entry.type === 2 || entry.type === 3) &&
        cleanCert(entry.certification),
    );
    const any = dates.find((entry) => cleanCert(entry.certification));
    const value =
      cleanCert(theatrical?.certification) ?? cleanCert(any?.certification);
    if (value) return value;
  }
  return "";
}

export function pickTvCertification(
  data: ContentRatings | undefined,
  region: string,
): string {
  const groups = data?.results ?? [];
  const wanted = (region || "US").toUpperCase();
  const ordered = [
    ...groups.filter((group) => group.iso_3166_1 === wanted),
    ...(wanted !== "US"
      ? groups.filter((group) => group.iso_3166_1 === "US")
      : []),
    ...groups.filter(
      (group) => group.iso_3166_1 !== wanted && group.iso_3166_1 !== "US",
    ),
  ];
  for (const group of ordered) {
    const value = cleanCert(group.rating);
    if (value) return value;
  }
  return "";
}

function cleanCert(value?: string): string {
  return value?.trim() ?? "";
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
    const file = join(appData, "rescore", "rescore.json");
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

async function scheduledTmdbFetch(url: URL): Promise<Response> {
  const scheduler = getTmdbScheduler();
  await scheduler.acquire();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) await discardBody(response);
    return response;
  } finally {
    scheduler.release();
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Status and headers were already read.
  }
}

function noteTmdbRateLimit(response: Response, attempt: number): void {
  getTmdbScheduler().penalize(
    parseRetryAfterMs(response.headers.get("retry-after"), Date.now()),
    attempt,
  );
}

function noteTmdbSuccess(): void {
  getTmdbScheduler().recover();
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
let loggedMissingKey = false;

export const MISSING_TMDB_KEY_MESSAGE =
  "No TMDB API key; skipping new poster lookups. Existing poster URLs are unchanged.";

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
    if (!loggedMissingKey) {
      loggedMissingKey = true;
      log(MISSING_TMDB_KEY_MESSAGE);
    }
    return Promise.resolve(null);
  }
  posterInflight = enrichPosters(catalog, {
    apiKey,
    handleSignals: false,
  })
    .catch((error: unknown) => {
      log(
        `Poster lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    })
    .finally(() => {
      posterInflight = null;
    });
  return posterInflight;
}
