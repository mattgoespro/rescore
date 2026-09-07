import {
  buildCatalogTitles,
  startCreditsBuild,
  type CatalogBuildResult,
} from "./catalog-builder.js";
import type { CatalogDatabase } from "./catalog-db.js";
import type { CatalogDownloadProgress } from "../types.js";

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
  return { ...status, download: status.download ? { ...status.download } : null };
}

export function isCatalogBuilding(): boolean {
  return status.phase === "building" || inflight != null;
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
  return { ...next, titlesReady: ready.titlesReady, creditsReady: ready.creditsReady };
}

export function refreshCatalogStatus(catalog: CatalogDatabase): CatalogStatusDto {
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
  if (!options.force && catalogIsUsable(catalog)) {
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
    void startCreditsBuild(catalog);
    return null;
  }

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

  try {
    const result = await buildCatalogTitles(catalog, {
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
    status = withReadiness(catalog, {
      phase: "ready",
      message: `Catalog ready with ${result.titleCount.toLocaleString()} titles.`,
      titleCount: result.titleCount,
      builtAt: result.builtAt,
      error: null,
      download: null,
    });
    void startCreditsBuild(catalog);
    return result;
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
