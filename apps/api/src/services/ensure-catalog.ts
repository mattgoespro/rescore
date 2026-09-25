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

export function catalogStatus(): CatalogStatusDto {
  return {
    ...status,
    download: status.download ? { ...status.download } : null,
  };
}

const EMPTY_TMDB_HYDRATION: TmdbHydrationProgress = {
  processed: 0,
  total: 0,
  percent: 0,
  message: "",
  complete: false,
};

let tmdbHydration: TmdbHydrationProgress = { ...EMPTY_TMDB_HYDRATION };

export function resetTmdbHydrationForTests(): void {
  tmdbHydration = { ...EMPTY_TMDB_HYDRATION };
}

export function tmdbHydrationPercent(
  processed: number,
  total: number,
  complete: boolean,
): number {
  if (complete) return 100;
  if (
    !Number.isFinite(processed) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    processed <= 0
  ) {
    return 0;
  }
  return Math.min(99, Math.floor((Math.min(processed, total) / total) * 100));
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Publish the scheduler's latest counters. Health reads this snapshot and does not scan titles. */
export function publishTmdbHydration(update: {
  processed: number;
  total: number;
  message: string;
  complete: boolean;
}): TmdbHydrationProgress {
  const processed = nonNegativeInt(update.processed);
  const total = nonNegativeInt(update.total);
  const complete = update.complete === true;
  tmdbHydration = {
    processed,
    total,
    percent: tmdbHydrationPercent(processed, total, complete),
    message: typeof update.message === "string" ? update.message.trim() : "",
    complete,
  };
  return readTmdbHydration();
}

export function readTmdbHydration(): TmdbHydrationProgress {
  return { ...tmdbHydration };
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
  if (catalogIsUsable(catalog)) {
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
  }
  return catalogStatus();
}

export function ensureCatalog(
  catalog: CatalogDatabase,
  options: { force?: boolean } = {},
): Promise<CatalogBuildResult | null> {
  if (inflight) return inflight;
  inflight = runEnsure(catalog, options).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runEnsure(
  catalog: CatalogDatabase,
  options: { force?: boolean },
): Promise<CatalogBuildResult | null> {
  const usable = !options.force && catalogIsUsable(catalog);
  if (usable) {
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
      message: catalog.isBuildInProgress()
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
          phase: progressPhase(usable, options.force === true),
          message: progress.message,
          titleCount: catalog.titleCount(),
          download: progress.download ?? null,
        });
      },
    });
    status = withReadiness(catalog, {
      phase: "ready",
      message: `Catalog ready with ${result.titleCount.toLocaleString()} titles.`,
      titleCount: result.titleCount,
      builtAt: result.builtAt,
      error: null,
      download: null,
    });
    void startCreditsBuild(catalog);
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
