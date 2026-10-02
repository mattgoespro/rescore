import { publishHydratedTitles } from "./ensure-catalog.js";
import { shutdownSignal, cancellableDelay, trackWork } from "./runtime-lifecycle.js";
import {
  TMDB_API_BASE,
  TMDB_CONCURRENCY,
  TMDB_IMAGE_BASE,
  TMDB_MAX_CONCURRENCY,
  TMDB_POSTER_PAGE_SIZE,
  TMDB_REQUESTS_PER_SECOND,
  tmdbApiKeys,
} from "../config.js";
import { languageCodes } from "../catalog/languages.js";
import { emit } from "../log/write.js";
import type { CatalogDatabase } from "./catalog-db.js";

const RATE_LIMIT_BACKOFF_CAP_MS = 30_000;
const RATE_LIMIT_JITTER = 0.25;
const RATE_RECOVERY_SUCCESSES = 8;

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
    if (!(options.requestsPerSecond > 0)) {
      throw new Error("TMDb requests per second must be positive");
    }
    if (!(options.concurrency >= 1)) {
      throw new Error("TMDb concurrency must be at least one");
    }
    this.budgetRps = options.requestsPerSecond;
    this.currentRps = options.requestsPerSecond;
    this.concurrency = Math.floor(options.concurrency);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? cancellableDelay;
    this.random = options.random ?? Math.random;
  }

  get requestsPerSecond(): number {
    return this.currentRps;
  }

  async acquire(): Promise<void> {
    for (;;) {
      shutdownSignal.throwIfAborted();
      if (this.inFlight >= this.concurrency) {
        await new Promise<void>((resolve, reject) => {
          const ready = (): void => {
            shutdownSignal.removeEventListener("abort", abort);
            resolve();
          };
          const abort = (): void => {
            const index = this.slotWaiters.indexOf(ready);
            if (index >= 0) this.slotWaiters.splice(index, 1);
            reject(shutdownSignal.reason);
          };
          this.slotWaiters.push(ready);
          shutdownSignal.addEventListener("abort", abort, { once: true });
        });
        continue;
      }
      const waitMs =
        Math.max(this.nextAllowedAt, this.blockedUntil) - this.now();
      if (waitMs > 0) {
        await this.sleep(waitMs);
        continue;
      }
      this.inFlight += 1;
      this.nextAllowedAt = this.now() + 1_000 / this.currentRps;
      return;
    }
  }

  release(): void {
    if (this.inFlight === 0) return;
    this.inFlight -= 1;
    this.slotWaiters.shift()?.();
  }

  penalize(retryAfterMs: number | null, attempt: number): void {
    const base =
      retryAfterMs == null
        ? Math.min(RATE_LIMIT_BACKOFF_CAP_MS, 1_000 * 2 ** attempt)
        : retryAfterMs;
    const jitter =
      base * RATE_LIMIT_JITTER * Math.max(0, Math.min(1, this.random()));
    const until = this.now() + base + jitter;
    const alreadyBlocked = this.now() < this.blockedUntil;
    this.blockedUntil = Math.max(this.blockedUntil, until);
    if (!alreadyBlocked) {
      this.currentRps = Math.max(1, this.currentRps / 2);
      this.successesSincePenalty = 0;
    }
  }

  recover(): void {
    if (this.now() < this.blockedUntil || this.currentRps >= this.budgetRps)
      return;
    this.successesSincePenalty += 1;
    if (this.successesSincePenalty < RATE_RECOVERY_SUCCESSES) return;
    this.successesSincePenalty = 0;
    this.currentRps = Math.min(
      this.budgetRps,
      this.currentRps + this.budgetRps / 4,
    );
  }
}

export interface TmdbClient {
  id: string;
  key: string;
  scheduler: TmdbRequestScheduler;
  disabled: boolean;
  requests: number;
  successes: number;
  rateLimits: number;
}

export class TmdbClientPool {
  private readonly clients: TmdbClient[];
  private cursor = 0;

  constructor(
    keys: string[],
    options: Pick<TmdbSchedulerOptions, "requestsPerSecond" | "concurrency">,
  ) {
    this.clients = [
      ...new Set(keys.map((key) => key.trim()).filter(Boolean)),
    ].map((key, index) => ({
      id: `key-${index + 1}`,
      key,
      scheduler: new TmdbRequestScheduler(options),
      disabled: false,
      requests: 0,
      successes: 0,
      rateLimits: 0,
    }));
  }

  next(): TmdbClient | null {
    const active = this.clients.filter((client) => !client.disabled);
    if (!active.length) return null;
    const client = active[this.cursor % active.length];
    this.cursor += 1;
    return client;
  }

  disable(client: TmdbClient | null | undefined): void {
    if (client) client.disabled = true;
  }

  get activeCount(): number {
    return this.clients.filter((client) => !client.disabled).length;
  }

  diagnostics(): Array<{
    id: string;
    disabled: boolean;
    requests: number;
    successes: number;
    rateLimits: number;
    requestsPerSecond: number;
  }> {
    return this.clients.map((client) => ({
      id: client.id,
      disabled: client.disabled,
      requests: client.requests,
      successes: client.successes,
      rateLimits: client.rateLimits,
      requestsPerSecond: client.scheduler.requestsPerSecond,
    }));
  }
}

interface HydrationJob {
  catalog: CatalogDatabase;
  id: string;
  kind: string;
  interactive: boolean;
  promise: Promise<boolean>;
  finish: (complete: boolean) => void;
}

export class TmdbHydrationCoordinator {
  readonly clients: TmdbClientPool;
  private readonly workersPerKey: number;
  private readonly maxConcurrency: number;

  constructor(
    keys: string[],
    options: Pick<TmdbSchedulerOptions, "requestsPerSecond" | "concurrency"> & {
      maxConcurrency?: number;
    },
  ) {
    this.clients = new TmdbClientPool(keys, options);
    this.workersPerKey = options.concurrency;
    this.maxConcurrency = options.maxConcurrency ?? Number.POSITIVE_INFINITY;
  }

  get workerCount(): number {
    return Math.min(
      this.maxConcurrency,
      this.workersPerKey * this.clients.activeCount,
    );
  }

  private readonly jobs = new WeakMap<CatalogDatabase, Map<string, HydrationJob>>();
  private readonly retryAfter = new WeakMap<CatalogDatabase, Map<string, number>>();
  private readonly queue: HydrationJob[] = [];
  private running = 0;
  private interactiveStreak = 0;

  hydrate(catalog: CatalogDatabase, id: string, kind: string, interactive: boolean): Promise<boolean> {
    const needsMedia = catalog.titleNeedsMedia(id);
    if (!needsMedia && !catalog.titleNeedsLanguages(id)) return Promise.resolve(true);
    let jobs = this.jobs.get(catalog);
    if (!jobs) { jobs = new Map(); this.jobs.set(catalog, jobs); }
    const existing = jobs.get(id);
    if (existing) {
      if (interactive) existing.interactive = true;
      return existing.promise;
    }
    if ((this.retryAfter.get(catalog)?.get(id) ?? 0) > Date.now()) return Promise.resolve(false);
    let finish!: (complete: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { finish = resolve; });
    const job = { catalog, id, kind, interactive, promise, finish };
    jobs.set(id, job);
    this.queue.push(job);
    queueMicrotask(() => this.pump());
    return trackWork(promise);
  }

  private pump(): void {
    while (this.running < this.workerCount && this.queue.length) {
      // Reserve regular opportunities for background work under sustained UI load.
      const preferred = this.interactiveStreak < 8
        ? this.queue.findIndex((job) => job.interactive)
        : this.queue.findIndex((job) => !job.interactive);
      const job = this.queue.splice(preferred < 0 ? 0 : preferred, 1)[0];
      this.interactiveStreak = job.interactive ? this.interactiveStreak + 1 : 0;
      this.running++;
      void this.execute(job).finally(() => { this.running--; this.pump(); });
    }
    if (!this.workerCount || shutdownSignal.aborted) {
      for (const job of this.queue.splice(0)) {
        this.jobs.get(job.catalog)?.delete(job.id);
        job.finish(false);
      }
    }
  }

  private async execute(job: HydrationJob): Promise<void> {
    let complete = false;
    try {
      shutdownSignal.throwIfAborted();
      if (job.catalog.titleNeedsMedia(job.id)) {
        const media = await findTitleMedia(this.clients, job.id, job.kind);
        await job.catalog.updatePosterUrlsQueued([{ id: job.id, ...media }]);
        publishHydratedTitles([job.id]);
      } else if (job.catalog.titleNeedsLanguages(job.id)) {
        const media = await findTitleMedia(this.clients, job.id, job.kind);
        await job.catalog.updatePosterUrlsQueued([{ id: job.id, languages: media.languages }]);
        publishHydratedTitles([job.id]);
      }
      complete = !job.catalog.titleNeedsMedia(job.id) && !job.catalog.titleNeedsLanguages(job.id);
      if (complete) this.retryAfter.get(job.catalog)?.delete(job.id);
    } catch (error) {
      let retry = this.retryAfter.get(job.catalog);
      if (!retry) { retry = new Map(); this.retryAfter.set(job.catalog, retry); }
      retry.set(job.id, Date.now() + 30_000);
      log(`Failed ${job.id}: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      this.jobs.get(job.catalog)?.delete(job.id);
      job.finish(complete);
    }
  }

  diagnostics(): ReturnType<TmdbClientPool["diagnostics"]> {
    return this.clients.diagnostics();
  }
}

export function parseRetryAfterMs(
  header: string | null,
  now = Date.now(),
): number | null {
  if (!header?.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) return Number(header) * 1_000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

interface FindHit {
  id?: number;
  poster_path?: string | null;
  overview?: string | null;
  original_language?: string | null;
}

interface FindResponse {
  movie_results?: FindHit[];
  tv_results?: FindHit[];
}

interface TitleMedia {
  posterUrl: string | null;
  synopsis: string | null;
  certification: string | null;
  languages: string[];
}

export interface PosterEnrichmentResult {
  processed: number;
  found: number;
  missing: number;
  errors: number;
}

export function formatEnrichmentProgress(input: {
  completedAtStart: number;
  processedThisRun: number;
  total: number;
  found: number;
  missing: number;
  errors: number;
}): string {
  return `Progress ${(input.completedAtStart + input.processedThisRun).toLocaleString("en-US")}/${input.total.toLocaleString("en-US")} · found ${input.found.toLocaleString("en-US")} · none ${input.missing.toLocaleString("en-US")} · errors ${input.errors.toLocaleString("en-US")}`;
}

export async function enrichPosters(
  catalog: CatalogDatabase,
  options: {
    apiKey?: string;
    apiKeys?: string[];
    concurrency?: number;
    handleSignals?: boolean;
    pageSize?: number;
    onProgress?: (processed: number, pending: number) => void;
  } = {},
): Promise<PosterEnrichmentResult> {
  const apiKeys =
    options.apiKeys ?? (options.apiKey ? [options.apiKey] : readTmdbApiKeys());
  const workersPerKey = options.concurrency ?? TMDB_CONCURRENCY;
  const coordinator = tmdbCoordinator(apiKeys, workersPerKey);
  if (coordinator.clients.activeCount === 0) {
    throw new Error("No usable TMDB API key");
  }
  const pageSize = options.pageSize ?? TMDB_POSTER_PAGE_SIZE;
  const hydration = catalog.hydrationStats();
  const pendingTotal = hydration.pending;
  const completedAtStart = hydration.processed;
  let durableProcessed = completedAtStart;
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
    `Looking up TMDB records for ${pendingTotal.toLocaleString()} titles (${coordinator.workerCount} workers, ${TMDB_REQUESTS_PER_SECOND} req/s per key)`,
  );

  activeTmdbCoordinator = coordinator;
  let stop = false;
  const onInterrupt = (): void => { stop = true; };
  if (options.handleSignals !== false) process.once("SIGINT", onInterrupt);
  try {
    while (!stop && !shutdownSignal.aborted) {
      const pending = catalog.listTitlesNeedingPosters(pageSize, drainPriorityIds(), true);
      if (!pending.length) break;
      const completed = await Promise.all(pending.map((title) =>
        coordinator.hydrate(catalog, title.id, title.kind, false)));
      stats.processed += completed.length;
      stats.errors += completed.filter((done) => !done).length;
      const rows = catalog.mediaFor(pending.map((title) => title.id));
      stats.found += rows.filter((row) => !!row.posterUrl).length;
      stats.missing += rows.filter((row) => row.posterUrl === "").length;
      durableProcessed = catalog.hydrationStats().processed;
      options.onProgress?.(durableProcessed, hydration.total);
      if (stats.errors) throw new Error(`${stats.errors} TMDb lookups failed. They will be retried.`);
      await yieldEventLoop();
    }
    return stats;
  } finally {
    if (options.handleSignals !== false) process.removeListener("SIGINT", onInterrupt);
  }
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
    hydrationComplete: boolean;
  }>
> {
  const rows = catalog.mediaFor(ids).slice(0, 40);
  const coordinator = activeTmdbCoordinator ?? tryCreateTmdbCoordinator();
  if (coordinator) await Promise.all(rows.map((row) => coordinator.hydrate(catalog, row.id, row.kind, true)));
  return catalog.mediaFor(rows.map((row) => row.id)).map((row) => ({
    id: row.id,
    synopsis: row.synopsis,
    posterUrl: row.posterUrl,
    certification: row.certification,
    hydrationComplete: !catalog.titleNeedsMedia(row.id),
  }));
}

class TmdbKeyRejectedError extends Error {
  constructor() {
    super("TMDB rejected an API key");
  }
}

async function findTitleMedia(
  clients: TmdbClientPool,
  imdbId: string,
  kind: string,
): Promise<TitleMedia> {
  let lastError: Error | null = null;
  const availableClients = clients.activeCount;
  for (let attempt = 0; attempt < availableClients; attempt++) {
    const client = clients.next();
    if (!client) break;
    try {
      return await findTitleMediaWithClient(client, imdbId, kind);
    } catch (error) {
      if (error instanceof TmdbKeyRejectedError) {
        clients.disable(client);
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("No usable TMDB API key");
}

async function findTitleMediaWithClient(
  client: TmdbClient,
  imdbId: string,
  kind: string,
): Promise<TitleMedia> {
  const url = new URL(`${TMDB_API_BASE}/find/${encodeURIComponent(imdbId)}`);
  url.searchParams.set("external_source", "imdb_id");
  url.searchParams.set("api_key", client.key);
  url.searchParams.set("language", "en-US");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await scheduledTmdbFetch(client, url);
    if (response.status === 429) {
      client.rateLimits += 1;
      client.scheduler.penalize(
        parseRetryAfterMs(response.headers.get("retry-after")),
        attempt,
      );
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new TmdbKeyRejectedError();
    }
    if (!response.ok) {
      lastError = new Error(`TMDB find failed (${response.status})`);
      await sleep(300 * (attempt + 1));
      continue;
    }
    client.successes += 1;
    client.scheduler.recover();
    const data = (await response.json()) as FindResponse;
    const preferred =
      kind === "tv" || kind === "miniseries"
        ? [...(data.tv_results ?? []), ...(data.movie_results ?? [])]
        : [...(data.movie_results ?? []), ...(data.tv_results ?? [])];
    const hit =
      preferred.find((item) => item.poster_path || item.overview?.trim()) ??
      preferred[0];
    const overview = hit?.overview?.trim() || null;
    const fromFind = languageCodes({
      original_language: hit?.original_language,
    });
    const facts = hit?.id
      ? await readTitleFacts(client, hit.id, kind)
      : { certification: "", languages: [] as string[] };
    return {
      posterUrl: hit?.poster_path
        ? `${TMDB_IMAGE_BASE}${hit.poster_path}`
        : null,
      synopsis: overview,
      certification: facts.certification,
      languages: facts.languages.length ? facts.languages : fromFind,
    };
  }
  throw lastError ?? new Error("TMDB rate limit exceeded");
}

export async function enrichOneTitle(
  catalog: CatalogDatabase,
  id: string,
  kind: string,
  coordinator = activeTmdbCoordinator ?? tryCreateTmdbCoordinator(),
): Promise<void> {
  if (coordinator) await coordinator.hydrate(catalog, id, kind, true);
}

interface TmdbTitleFacts {
  original_language?: string | null;
  spoken_languages?: Array<{ iso_639_1?: string | null }>;
  release_dates?: ReleaseDates;
  content_ratings?: ContentRatings;
}

async function readTitleFacts(
  client: TmdbClient,
  tmdbId: number,
  kind: string,
): Promise<{ certification: string; languages: string[] }> {
  const tv = kind === "tv" || kind === "miniseries";
  const url = new URL(
    `${TMDB_API_BASE}${tv ? `/tv/${tmdbId}` : `/movie/${tmdbId}`}`,
  );
  url.searchParams.set("api_key", client.key);
  url.searchParams.set(
    "append_to_response",
    tv ? "content_ratings" : "release_dates",
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await scheduledTmdbFetch(client, url);
    if (response.status === 429) {
      client.rateLimits += 1;
      client.scheduler.penalize(
        parseRetryAfterMs(response.headers.get("retry-after")),
        attempt,
      );
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new TmdbKeyRejectedError();
    }
    if (response.status === 404) return { certification: "", languages: [] };
    if (!response.ok) {
      throw new Error(`TMDB certification failed (${response.status})`);
    }
    client.successes += 1;
    client.scheduler.recover();
    const data = (await response.json()) as TmdbTitleFacts;
    const region = (process.env.CATALOG_REGION || "US").toUpperCase();
    return {
      certification: tv
        ? pickTvCertification(data.content_ratings, region)
        : pickMovieCertification(data.release_dates, region),
      languages: languageCodes(data),
    };
  }
  throw new Error("TMDB certification rate limit exceeded");
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

export function tryReadTmdbApiKeys(): string[] | null {
  try {
    return readTmdbApiKeys();
  } catch {
    return null;
  }
}

export function tryReadTmdbApiKey(): string | null {
  return tryReadTmdbApiKeys()?.[0] ?? null;
}

export function readTmdbApiKeys(): string[] {
  const keys = tmdbApiKeys(process.env.TMDB_API_KEYS, process.env.TMDB_API_KEY);
  if (keys.length) return keys;
  throw new Error("TMDb API keys are missing from this build.");
}

export function readTmdbApiKey(): string {
  return readTmdbApiKeys()[0];
}

function tryCreateTmdbCoordinator(): TmdbHydrationCoordinator | null {
  const keys = tryReadTmdbApiKeys();
  return keys ? tmdbCoordinator(keys, TMDB_CONCURRENCY) : null;
}

function tmdbCoordinator(
  keys: string[],
  workersPerKey: number,
): TmdbHydrationCoordinator {
  const keySignature = keys.join("\n");
  if (
    activeTmdbCoordinator &&
    activeTmdbKeySignature === keySignature &&
    activeTmdbWorkersPerKey === workersPerKey
  ) {
    return activeTmdbCoordinator;
  }
  activeTmdbCoordinator = new TmdbHydrationCoordinator(keys, {
    requestsPerSecond: TMDB_REQUESTS_PER_SECOND,
    concurrency: workersPerKey,
    maxConcurrency: TMDB_MAX_CONCURRENCY,
  });
  activeTmdbKeySignature = keySignature;
  activeTmdbWorkersPerKey = workersPerKey;
  return activeTmdbCoordinator;
}

async function scheduledTmdbFetch(
  client: TmdbClient,
  url: URL,
): Promise<Response> {
  await client.scheduler.acquire();
  try {
    client.requests += 1;
    return await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.any([shutdownSignal, AbortSignal.timeout(20000)]) });
  } finally {
    client.scheduler.release();
  }
}

function sleep(ms: number): Promise<void> {
  return cancellableDelay(ms);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function drainPriorityIds(): string[] {
  const ids = priorityIds.splice(0, priorityIds.length);
  return ids;
}

function log(message: string): void {
  emit({ channel: "posters", phase: "posters", level: "info", message });
}

let posterInflight: Promise<PosterEnrichmentResult | null> | null = null;
let activeTmdbCoordinator: TmdbHydrationCoordinator | null = null;
let activeTmdbKeySignature: string | null = null;
let activeTmdbWorkersPerKey: number | null = null;
const priorityIds: string[] = [];
let loggedMissingKey = false;

export const MISSING_TMDB_KEY_MESSAGE =
  "No TMDB API keys; skipping new poster lookups. Existing poster URLs are unchanged.";

export function prioritizePosterIds(ids: string[]): void {
  for (const id of ids) {
    const key = id.toLowerCase();
    if (!key || priorityIds.includes(key)) continue;
    priorityIds.unshift(key);
  }
}

let lastPosterError: string | null = null;
export function posterEnrichmentError(): string | null { return lastPosterError; }

export function isPosterEnrichmentRunning(): boolean {
  return posterInflight != null;
}

export function startPosterEnrichment(
  catalog: CatalogDatabase,
  options: {
    ids?: string[];
    onProgress?: (processed: number, pending: number) => void;
  } = {},
): Promise<PosterEnrichmentResult | null> {
  shutdownSignal.throwIfAborted();
  if (options.ids?.length) prioritizePosterIds(options.ids);
  if (posterInflight) return posterInflight;
  lastPosterError = null;
  const apiKeys = tryReadTmdbApiKeys();
  if (!apiKeys?.length) {
    lastPosterError = MISSING_TMDB_KEY_MESSAGE;
    if (!loggedMissingKey) {
      loggedMissingKey = true;
      log(MISSING_TMDB_KEY_MESSAGE);
    }
    return Promise.resolve(null);
  }
  posterInflight = enrichPosters(catalog, {
    apiKeys,
    handleSignals: false,
    onProgress: options.onProgress,
  })
    .catch((error: unknown) => {
      lastPosterError = error instanceof Error ? error.message : String(error);
      emit({
        channel: "posters",
        phase: "posters",
        level: "warn",
        message: `Poster lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    })
    .finally(() => {
      posterInflight = null;
    });
  return trackWork(posterInflight);
}
