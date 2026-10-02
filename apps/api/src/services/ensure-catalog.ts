import { trackWork, shutdownSignal, cancellableDelay } from "./runtime-lifecycle.js";
import { emit } from "../log/write.js";
import {
  buildCatalogTitles,
  startCreditsBuild,
  type CatalogBuildResult,
} from "./catalog-builder.js";
import type { CatalogDatabase } from "./catalog-db.js";
import type {
  CatalogDownloadProgress,
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
  processed: number;
  total: number;
  complete: boolean;
  message: string;
}): void {
  const processed = Math.max(0, Math.floor(update.processed));
  const total = Math.max(0, Math.floor(update.total));
  const complete = update.complete === true;
  tmdbHydration = {
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

export function catalogStatus(): CatalogStatusDto {
  return {
    ...status,
    download: status.download ? { ...status.download } : null,
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

/** IMDb readiness is independent of optional TMDb metadata availability. */
export function isCatalogUsable(input: {
  titlesReady: boolean;
  creditsReady: boolean;
  creditsFailed?: boolean;
  tmdbReady?: boolean;
}): boolean {
  return (
    input.titlesReady &&
    input.creditsReady &&
    input.creditsFailed !== true
  );
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
  next: Omit<CatalogStatusDto, "titlesReady" | "creditsReady">,
): CatalogStatusDto {
  const ready = catalog.readiness();
  return {
    ...next,
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
  const hydration = catalog.hydrationStats();
  publishTmdbHydration({
    processed: hydration.processed,
    total: hydration.total,
    complete: hydration.complete && hydration.total > 0,
    message: hydration.complete
      ? "TMDb hydration complete."
      : "Loading posters, synopses, and age ratings…",
  });
  const usable = isCatalogUsable({
    titlesReady: ready.titlesReady,
    creditsReady: ready.creditsReady,
    creditsFailed: catalog.creditsFailed(),
    tmdbReady: readTmdbHydration().complete,
  });
  if (usable) {
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
  } else if (ready.titlesReady && ready.creditsReady) {
    status = withReadiness(catalog, {
      phase: "building",
      message: "Loading posters, synopses, and age ratings…",
      titleCount: catalog.titleCount(),
      builtAt: catalog.catalogMeta().builtAt,
      error: null,
      download: null,
    });
  } else if (ready.titlesReady) {
    status = withReadiness(catalog, {
      phase: "building",
      message: "Loading credits…",
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
  const initialHydration = catalog.hydrationStats();
  publishTmdbHydration({
    processed: initialHydration.processed,
    total: initialHydration.total,
    complete: initialHydration.complete && initialHydration.total > 0,
    message: initialHydration.complete
      ? "TMDb hydration complete."
      : "Loading posters, synopses, and age ratings…",
  });
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
      message: imdbReady
        ? "Loading posters, synopses, and age ratings…"
        : catalog.isBuildInProgress()
          ? "Resuming an interrupted catalog build…"
          : "Building catalog from IMDb datasets…",
      titleCount: catalog.titleCount(),
      builtAt: catalog.catalogMeta().builtAt,
      error: null,
      download: null,
    });
  }

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
    });
    const creditsPending =
      options.force === true ||
      !catalog.creditsReady() ||
      catalog.creditsFailed();
    if (creditsPending) {
      status = withReadiness(catalog, {
        phase: "building",
        message: "Loading credits…",
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
    const ready = catalog.readiness();
    const imdbComplete =
      ready.titlesReady && ready.creditsReady && !catalog.creditsFailed();
    if (!imdbComplete) {
      status = withReadiness(catalog, {
        phase: "error",
        message: "Credits could not be loaded.",
        titleCount: catalog.titleCount(),
        builtAt: catalog.catalogMeta().builtAt,
        error:
          "Credits could not be loaded. They will be tried again next launch.",
        download: null,
      });
      return result.unchanged ? null : result;
    }
    status = withReadiness(catalog, {
      phase: "ready",
      message: `Catalog ready with ${result.titleCount.toLocaleString()} titles.`,
      titleCount: result.titleCount,
      builtAt: result.builtAt,
      error: null,
      download: null,
    });
    // Upkeep is tracked separately; browsing and ratings sync do not wait for TMDb.
    void hydrateInBackground(catalog);
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
function hydrateInBackground(catalog: CatalogDatabase): Promise<void> {
  if (hydrationWork) return hydrationWork;
  hydrationWork = trackWork((async () => {
    const { startPosterEnrichment, posterEnrichmentError } = await import("./tmdb-posters.js");
    let attempt = 0;
    let retryAt: number | null = null;
    let previous = catalog.hydrationStats().processed;
    let previousAt = Date.now();
    const report = (): void => {
      const stats = catalog.hydrationStats();
      const now = Date.now();
      const rate = Math.max(0, stats.processed - previous) / Math.max(0.001, (now - previousAt) / 1000);
      const error = posterEnrichmentError();
      const state = stats.complete ? "complete" : shutdownSignal.aborted ? "stopping"
        : retryAt !== null ? `retry in ${Math.max(0, Math.ceil((retryAt - now) / 1000))}s` : "active";
      emit({ channel: "posters", phase: "posters", level: "info",
        message: `Progress ${stats.processed.toLocaleString("en-US")}/${stats.total.toLocaleString("en-US")} | ${rate.toFixed(1)} titles/s | ${state} | last error: ${error ?? "none"}` });
      previous = stats.processed;
      previousAt = now;
    };
    const heartbeat = setInterval(report, 30_000);
    heartbeat.unref();
    try {
      while (!shutdownSignal.aborted) {
        retryAt = null;
        const publish = (): void => {
          const stats = catalog.hydrationStats();
          publishTmdbHydration({ ...stats, message: stats.complete
            ? "TMDb hydration complete."
            : posterEnrichmentError() ?? "Loading metadata in the background. You can keep browsing." });
        };
        await startPosterEnrichment(catalog, { onProgress: publish });
        publish();
        if (catalog.hydrationStats().complete) return;
        const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempt++, 5));
        retryAt = Date.now() + delay;
        report();
        await cancellableDelay(delay);
      }
    } finally {
      clearInterval(heartbeat);
      report();
    }
  })().catch((error: unknown) => {
    if (!shutdownSignal.aborted) publishTmdbHydration({ ...catalog.hydrationStats(),
      message: error instanceof Error ? error.message : "Metadata lookup failed. Browse to retry a title." });
  }).finally(() => { hydrationWork = null; }));
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
      for (const listener of tmdbHydrationSubscribers) listener({ ...readTmdbHydration(), completedIds: ids.slice(offset, offset + 400) });
    }
  }, 100).unref();
}
