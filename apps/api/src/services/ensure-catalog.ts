import {
  trackWork,
  shutdownSignal,
  cancellableDelay,
} from "./runtime-lifecycle.js";
import { emit } from "../log/write.js";
import { runMetadataRetries } from "./metadata-retries.js";
import {
  buildCatalogTitles,
  startCreditsBuild,
  type CatalogBuildResult,
} from "./catalog-builder.js";
import type { CatalogDatabase } from "./catalog-db.js";
import type {
  CatalogDownloadProgress,
  CatalogSetupProgress,
  TmdbHydrationProgress,
} from "../types.js";

export type CatalogPhase = "idle" | "building" | "ready" | "error";

export interface CatalogStatusDto {
  phase: CatalogPhase;
  message: string;
  titleCount: number;
  builtAt: string | null;
  error: string | null;
  download: CatalogDownloadProgress | null;
  /** The title steps that hold browsing, while they run. */
  setup: CatalogSetupProgress | null;
  titlesReady: boolean;
  creditsReady: boolean;
}

let status: CatalogStatusDto = {
  phase: "idle",
  message: "Catalog has not started yet.",
  titleCount: 0,
  builtAt: null,
  error: null,
  download: null,
  setup: null,
  titlesReady: false,
  creditsReady: false,
};

let inflight: Promise<CatalogBuildResult | null> | null = null;

const EMPTY_TMDB_HYDRATION: TmdbHydrationProgress = {
  processed: 0,
  total: 0,
  percent: 0,
  complete: false,
  message: "",
};

let tmdbHydration: TmdbHydrationProgress = { ...EMPTY_TMDB_HYDRATION };
const tmdbHydrationSubscribers = new Set<
  (progress: TmdbHydrationProgress) => void
>();

export function readTmdbHydration(): TmdbHydrationProgress {
  return { ...tmdbHydration };
}

export function subscribeTmdbHydration(
  listener: (progress: TmdbHydrationProgress) => void,
): () => void {
  tmdbHydrationSubscribers.add(listener);
  return () => tmdbHydrationSubscribers.delete(listener);
}

export function publishTmdbHydration(update: {
  posters?: number;
  synopses?: number;
  processed: number;
  total: number;
  complete: boolean;
  message: string;
}): void {
  const processed = Math.max(0, Math.floor(update.processed));
  const total = Math.max(0, Math.floor(update.total));
  const complete = update.complete === true;
  tmdbHydration = {
    ...(update.posters !== undefined ? { posters: update.posters } : {}),
    ...(update.synopses !== undefined ? { synopses: update.synopses } : {}),
    processed,
    total,
    percent: complete
      ? 100
      : total > 0
        ? Math.min(99, Math.floor((Math.min(processed, total) / total) * 100))
        : 0,
    complete,
    message: update.message.trim(),
  };
  for (const listener of tmdbHydrationSubscribers) {
    listener(readTmdbHydration());
  }
}

function coverageMessage(coverage: {
  total: number;
  posters: number;
  synopses: number;
}): string {
  const count = (filled: number): string =>
    `${filled.toLocaleString("en-US")}/${coverage.total.toLocaleString("en-US")} (${coverage.total > 0 ? ((filled / coverage.total) * 100).toFixed(1) : "0.0"}%)`;
  return `Posters: ${count(coverage.posters)}. Synopses: ${count(coverage.synopses)}.`;
}

function publishCatalogHydration(
  catalog: CatalogDatabase,
  error?: string | null,
): void {
  const stats = catalog.hydrationStats();
  const coverage = catalog.tmdbCoverage();
  const complete = stats.complete && stats.total > 0;
  const message =
    error ??
    (complete
      ? "TMDb lookups complete."
      : "Loading metadata in the background. You can keep browsing.");
  publishTmdbHydration({
    ...stats,
    complete,
    posters: coverage.posters,
    synopses: coverage.synopses,
    message: `${message} ${coverageMessage(coverage)}`,
  });
}

export function catalogStatus(): CatalogStatusDto {
  return {
    ...status,
    download: status.download ? { ...status.download } : null,
    setup: status.setup
      ? {
          ...status.setup,
          files: status.setup.files.map((file) => ({ ...file })),
          index: { ...status.setup.index },
        }
      : null,
  };
}

export function isCatalogBuilding(): boolean {
  return status.phase === "building" || inflight != null;
}

export function progressPhase(usable: boolean, force = false): CatalogPhase {
  return usable && !force ? "ready" : "building";
}

export function catalogHealthReady(
  titleCount: number,
  phase: CatalogPhase,
  titlesReady: boolean,
): boolean {
  const blockingBuild = phase === "building" && !titlesReady;
  return titleCount > 0 && !blockingBuild && phase !== "error";
}

/**
 * Browsing needs IMDb titles only. Cast, directors and TMDb metadata fill in
 * afterwards; a forced rebuild holds browsing until its titles are reconciled.
 */
export function isCatalogUsable(input: {
  titlesReady: boolean;
  titlesRebuilding?: boolean;
}): boolean {
  return input.titlesReady && input.titlesRebuilding !== true;
}

let titlesRebuilding = false;

export function isTitlesRebuilding(): boolean {
  return titlesRebuilding;
}

function catalogIsUsable(catalog: CatalogDatabase): boolean {
  return (
    catalog.titleCount() > 0 &&
    Boolean(catalog.catalogMeta().builtAt) &&
    catalog.isHealthy()
  );
}

function withReadiness(
  catalog: CatalogDatabase,
  next: Omit<CatalogStatusDto, "titlesReady" | "creditsReady" | "setup"> & {
    setup?: CatalogSetupProgress | null;
  },
): CatalogStatusDto {
  const ready = catalog.readiness();
  return {
    ...next,
    setup: next.setup ?? null,
    titlesReady: ready.titlesReady,
    creditsReady: ready.creditsReady,
  };
}

export function refreshCatalogStatus(
  catalog: CatalogDatabase,
): CatalogStatusDto {
  if (status.phase === "building") {
    status = withReadiness(catalog, {
      ...status,
      titleCount: catalog.titleCount(),
    });
    return catalogStatus();
  }
  const ready = catalog.readiness();
  publishCatalogHydration(catalog);
  if (ready.titlesReady && ready.creditsReady && !catalog.creditsFailed()) {
    const titleCount = catalog.titleCount();
    const meta = catalog.catalogMeta();
    status = withReadiness(catalog, {
      phase: "ready",
      message: `Using existing catalog (${titleCount.toLocaleString()} titles).`,
      titleCount,
      builtAt: meta.builtAt,
      error: null,
      download: null,
    });
  } else if (ready.titlesReady) {
    status = withReadiness(catalog, {
      phase: "building",
      message: "Loading cast and directors…",
      titleCount: catalog.titleCount(),
      builtAt: catalog.catalogMeta().builtAt,
      error: null,
      download: null,
    });
  }
  return catalogStatus();
}

export function ensureCatalog(
  catalog: CatalogDatabase,
  options: { force?: boolean } = {},
): Promise<CatalogBuildResult | null> {
  if (inflight) return inflight;
  shutdownSignal.throwIfAborted();
  inflight = runEnsure(catalog, options).finally(() => {
    inflight = null;
  });
  return trackWork(inflight);
}

async function runEnsure(
  catalog: CatalogDatabase,
  options: { force?: boolean },
): Promise<CatalogBuildResult | null> {
  const titlesReusable = !options.force && catalogIsUsable(catalog);
  const imdbReady =
    titlesReusable && catalog.creditsReady() && !catalog.creditsFailed();
  publishCatalogHydration(catalog);
  const catalogReady = imdbReady;
  if (catalogReady) {
    if (catalog.isBuildInProgress()) {
      catalog.setBuildInProgress(false);
    }
    const titleCount = catalog.titleCount();
    const meta = catalog.catalogMeta();
    status = withReadiness(catalog, {
      phase: "ready",
      message: `Using existing catalog (${titleCount.toLocaleString()} titles).`,
      titleCount,
      builtAt: meta.builtAt,
      error: null,
      download: null,
    });
  } else {
    status = withReadiness(catalog, {
      phase: "building",
      message: titlesReusable
        ? "Loading cast and directors…"
        : catalog.isBuildInProgress()
          ? "Resuming an interrupted catalog build…"
          : "Building catalog from IMDb datasets…",
      titleCount: catalog.titleCount(),
      builtAt: catalog.catalogMeta().builtAt,
      error: null,
      download: null,
    });
  }

  titlesRebuilding = options.force === true;
  try {
    const result = await buildCatalogTitles(catalog, {
      force: options.force,
      onProgress: (progress) => {
        status = withReadiness(catalog, {
          ...status,
          phase: progressPhase(catalogReady, options.force === true),
          message: progress.message,
          titleCount: catalog.titleCount(),
          download: progress.download ?? null,
        });
      },
      onSetup: (setup) => {
        status = { ...status, setup };
      },
    }).finally(() => {
      titlesRebuilding = false;
    });
    const creditsPending =
      options.force === true ||
      !catalog.creditsReady() ||
      catalog.creditsFailed();
    if (creditsPending) {
      status = withReadiness(catalog, {
        phase: "building",
        message: "Loading cast and directors…",
        titleCount: catalog.titleCount(),
        builtAt: catalog.catalogMeta().builtAt,
        error: null,
        download: null,
      });
      await startCreditsBuild(catalog, {
        force: options.force,
        onProgress: (progress) => {
          status = withReadiness(catalog, {
            ...status,
            phase: "building",
            message: progress.message,
            titleCount: catalog.titleCount(),
            download: progress.download ?? null,
          });
        },
      });
    }
    // Missing cast and directors leave browsing open; creditsFailed tells the
    // interface, and the next launch tries the import again.
    const creditsMissing = !catalog.creditsReady() || catalog.creditsFailed();
    status = withReadiness(catalog, {
      phase: "ready",
      message: creditsMissing
        ? `Catalog ready with ${result.titleCount.toLocaleString()} titles. Cast and directors could not be loaded.`
        : `Catalog ready with ${result.titleCount.toLocaleString()} titles.`,
      titleCount: result.titleCount,
      builtAt: result.builtAt,
      error: null,
      download: null,
    });
    // Upkeep is tracked separately; browsing and ratings sync do not wait for TMDb.
    void hydrateInBackground(catalog);
    startMetadataRetries(catalog);
    return result.unchanged ? null : result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status = withReadiness(catalog, {
      phase: "error",
      message: "Catalog build failed.",
      titleCount: catalog.titleCount(),
      builtAt: catalog.catalogMeta().builtAt,
      error: message,
      download: null,
    });
    throw error;
  }
}

let hydrationWork: Promise<void> | null = null;
let metadataRetryWork: Promise<void> | null = null;
function startMetadataRetries(catalog: CatalogDatabase): void {
  if (metadataRetryWork) return;
  metadataRetryWork = trackWork(
    runMetadataRetries(
      catalog,
      (ids) => hydrateInBackground(catalog, ids),
      () => !isCatalogBuilding() && hydrationWork === null,
    )
      .catch((error: unknown) => {
        if (!shutdownSignal.aborted)
          emit({
            channel: "posters",
            phase: "posters",
            level: "warn",
            message: `Metadata retries stopped: ${error instanceof Error ? error.message : String(error)}`,
          });
      })
      .finally(() => {
        metadataRetryWork = null;
      }),
  );
}

function hydrateInBackground(
  catalog: CatalogDatabase,
  ids: string[] = [],
): Promise<void> {
  if (hydrationWork) return hydrationWork;
  hydrationWork = trackWork(
    (async () => {
      const { startPosterEnrichment, posterEnrichmentError } =
        await import("./tmdb-posters.js");
      let attempt = 0;
      let retryAt: number | null = null;
      let previous = catalog.hydrationStats().processed;
      let previousAt = Date.now();
      const report = (): void => {
        const stats = catalog.hydrationStats();
        const coverage = catalog.tmdbCoverage();
        const now = Date.now();
        const rate =
          Math.max(0, stats.processed - previous) /
          Math.max(0.001, (now - previousAt) / 1000);
        const error = posterEnrichmentError();
        const state = stats.complete
          ? "complete"
          : shutdownSignal.aborted
            ? "stopping"
            : retryAt !== null
              ? `retry in ${Math.max(0, Math.ceil((retryAt - now) / 1000))}s`
              : "active";
        emit({
          channel: "posters",
          phase: "posters",
          level: "info",
          message: `Progress ${stats.processed.toLocaleString("en-US")}/${stats.total.toLocaleString("en-US")} | ${rate.toFixed(1)} titles/s | ${state} | last error: ${error ?? "none"} | ${coverageMessage(coverage)}`,
        });
        previous = stats.processed;
        previousAt = now;
      };
      const heartbeat = setInterval(report, 30_000);
      heartbeat.unref();
      try {
        while (!shutdownSignal.aborted) {
          retryAt = null;
          const publish = (): void => {
            publishCatalogHydration(catalog, posterEnrichmentError());
          };
          publish();
          await startPosterEnrichment(catalog, { ids, onProgress: publish });
          publish();
          if (catalog.hydrationStats().complete) return;
          const delay = Math.min(
            15 * 60_000,
            30_000 * 2 ** Math.min(attempt++, 5),
          );
          retryAt = Date.now() + delay;
          report();
          await cancellableDelay(delay);
        }
      } finally {
        clearInterval(heartbeat);
        report();
      }
    })()
      .catch((error: unknown) => {
        if (!shutdownSignal.aborted)
          publishCatalogHydration(
            catalog,
            error instanceof Error
              ? error.message
              : "Metadata lookup failed. Browse to retry a title.",
          );
      })
      .finally(() => {
        hydrationWork = null;
      }),
  );
  return hydrationWork;
}

// Completion notifications are transient; persisted progress never replays old title IDs.
const completedTitles = new Set<string>();
let completionTimer: ReturnType<typeof setTimeout> | null = null;
export function publishHydratedTitles(completedIds: string[]): void {
  for (const id of completedIds) completedTitles.add(id);
  if (completionTimer) return;
  completionTimer = setTimeout(() => {
    completionTimer = null;
    const ids = [...completedTitles];
    completedTitles.clear();
    for (let offset = 0; offset < ids.length; offset += 400) {
      for (const listener of tmdbHydrationSubscribers)
        listener({
          ...readTmdbHydration(),
          completedIds: ids.slice(offset, offset + 400),
        });
    }
  }, 100).unref();
}
