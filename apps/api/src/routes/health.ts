import { Router } from "express";
import { serviceConfig } from "../services/service-environment.js";
import type { CatalogDatabase } from "../services/catalog-db.js";
import {
  catalogHealthReady,
  catalogStatus,
  isCatalogUsable,
  readTmdbHydration,
} from "../services/ensure-catalog.js";
import type { RatingsStore } from "../services/ratings-store.js";
import type { HealthResponse } from "../types.js";

export function healthRouter(store: RatingsStore, catalog: CatalogDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const runtime = catalogStatus();
    const hydration = readTmdbHydration();
    const titleCount = runtime.titleCount;
    const building = runtime.phase === "building";
    const body: HealthResponse = {
      runtimeMode: serviceConfig ? "service" : "app",
      protocolVersion: 1,
      catalogId: serviceConfig?.catalogId ?? null,
      runtimeVersion: serviceConfig?.runtimeVersion ?? null,
      ok: true,
      ready: catalogHealthReady(
        titleCount,
        runtime.phase,
        runtime.titlesReady,
      ),
      building,
      catalogPhase: runtime.phase,
      catalogMessage: runtime.message,
      catalogError: runtime.error,
      catalogDownload: runtime.download,
      syncedAt: store.lastSyncedAt(),
      titleCount,
      ratingsCount: store.titleCount(),
      catalogBuiltAt: runtime.builtAt,
      catalogRevision: null,
      titlesReady: runtime.titlesReady,
      creditsReady: runtime.creditsReady,
      titlesUpdateAvailable: catalog.titlesUpdateAvailable(),
      creditsFailed: catalog.creditsFailed(),
      catalogUsable: isCatalogUsable({
        titlesReady: runtime.titlesReady,
        creditsReady: runtime.creditsReady,
        creditsFailed: catalog.creditsFailed(),
        tmdbReady: hydration.complete,
      }),
      tmdbHydration: hydration,
    };
    res.status(200).json(body);
  });

  return router;
}
