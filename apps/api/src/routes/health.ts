import { Router } from "express";
import type { CatalogDatabase } from "../services/catalog-db.js";
import {
  catalogHealthReady,
  catalogStatus,
} from "../services/ensure-catalog.js";
import type { RatingsStore } from "../services/ratings-store.js";
import type { HealthResponse } from "../types.js";

export function healthRouter(store: RatingsStore, catalog: CatalogDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const runtime = catalogStatus();
    const meta = catalog.catalogMeta();
    const titleCount =
      runtime.titleCount > 0 ? runtime.titleCount : catalog.titleCount();
    const building = runtime.phase === "building";
    const ready = catalog.readiness();
    const body: HealthResponse = {
      ok: true,
      ready: catalogHealthReady(
        titleCount,
        runtime.phase,
        ready.titlesReady,
      ),
      building,
      catalogPhase: runtime.phase,
      catalogMessage: runtime.message,
      catalogError: runtime.error,
      catalogDownload: runtime.download,
      syncedAt: store.lastSyncedAt(),
      titleCount,
      ratingsCount: store.titleCount(),
      catalogBuiltAt: meta.builtAt,
      catalogRevision: meta.revision,
      titlesReady: ready.titlesReady,
      creditsReady: ready.creditsReady,
      titlesUpdateAvailable: catalog.titlesUpdateAvailable(),
    };
    res.status(200).json(body);
  });

  return router;
}
