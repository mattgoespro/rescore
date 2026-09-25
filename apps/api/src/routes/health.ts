import { Router } from "express";
import type { CatalogDatabase } from "../services/catalog-db.js";
import {
  catalogHealthReady,
  catalogStatus,
  readTmdbHydration,
  type CatalogStatusDto,
} from "../services/ensure-catalog.js";
import type { RatingsStore } from "../services/ratings-store.js";
import type { HealthResponse, TmdbHydrationProgress } from "../types.js";

const HEALTH_CATALOG_TTL_MS = 5_000;

interface CatalogPollFacts {
  at: number;
  includedTitleScan: boolean;
  builtAt: string | null;
  revision: string | null;
  titleCount: number;
  titlesReady: boolean;
  creditsReady: boolean;
  titlesUpdateAvailable: boolean;
  creditsFailed: boolean;
}

let catalogPollFacts: CatalogPollFacts | null = null;

export function resetHealthCatalogCacheForTests(): void {
  catalogPollFacts = null;
}

function freshFacts(
  catalog: CatalogDatabase,
  runtime: CatalogStatusDto,
  hydration: TmdbHydrationProgress,
  now: number,
): CatalogPollFacts {
  const meta = catalog.catalogMeta();
  const facts: CatalogPollFacts = {
    at: now,
    includedTitleScan: false,
    builtAt: runtime.builtAt ?? meta.builtAt,
    revision: meta.revision,
    titleCount: runtime.titleCount,
    titlesReady: runtime.titlesReady,
    creditsReady: runtime.creditsReady,
    titlesUpdateAvailable: catalog.titlesUpdateAvailable(),
    creditsFailed: catalog.creditsFailed(),
  };
  if (!hydration.complete) return facts;
  const ready = catalog.readiness();
  facts.includedTitleScan = true;
  facts.titlesReady = ready.titlesReady;
  facts.creditsReady = ready.creditsReady;
  if (runtime.titleCount <= 0) facts.titleCount = catalog.titleCount();
  return facts;
}

function catalogFacts(
  catalog: CatalogDatabase,
  runtime: CatalogStatusDto,
  hydration: TmdbHydrationProgress,
  now = Date.now(),
): CatalogPollFacts {
  const cached = catalogPollFacts;
  const freshEnough = cached != null && now - cached.at < HEALTH_CATALOG_TTL_MS;
  const scanCovered = !hydration.complete || cached?.includedTitleScan === true;
  if (cached && freshEnough && scanCovered) {
    return {
      ...cached,
      builtAt: runtime.builtAt ?? cached.builtAt,
      titleCount:
        runtime.titleCount > 0 ? runtime.titleCount : cached.titleCount,
      titlesReady: hydration.complete
        ? cached.titlesReady
        : runtime.titlesReady,
      creditsReady: hydration.complete
        ? cached.creditsReady
        : runtime.creditsReady,
    };
  }
  catalogPollFacts = freshFacts(catalog, runtime, hydration, now);
  return catalogPollFacts;
}

export function healthRouter(
  store: RatingsStore,
  catalog: CatalogDatabase,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const runtime = catalogStatus();
    const hydration = readTmdbHydration();
    const facts = catalogFacts(catalog, runtime, hydration);
    const building = runtime.phase === "building";
    const body: HealthResponse = {
      ok: true,
      ready: catalogHealthReady(
        facts.titleCount,
        runtime.phase,
        facts.titlesReady,
      ),
      building,
      catalogPhase: runtime.phase,
      catalogMessage: runtime.message,
      catalogError: runtime.error,
      catalogDownload: runtime.download,
      syncedAt: store.lastSyncedAt(),
      titleCount: facts.titleCount,
      ratingsCount: store.titleCount(),
      catalogBuiltAt: facts.builtAt,
      catalogRevision: facts.revision,
      titlesReady: facts.titlesReady,
      creditsReady: facts.creditsReady,
      titlesUpdateAvailable: facts.titlesUpdateAvailable,
      creditsFailed: facts.creditsFailed,
      tmdbHydration: hydration,
    };
    res.status(200).json(body);
  });

  return router;
}
