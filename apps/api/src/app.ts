import cors from "cors";
import { serviceConfig } from "./services/service-environment.js";
import { runtimeAuth } from "./services/runtime-auth.js";
import { shutdownSignal } from "./services/runtime-lifecycle.js";
import express from "express";
import { requestLog } from "./log/http.js";
import { errorHandler } from "./middleware/error.js";
import { healthRouter } from "./routes/health.js";
import { createHydrationEventsRouter } from "./routes/hydration-events.js";
import { ratingsRouter } from "./routes/ratings.js";
import { v1Router } from "./routes/v1.js";
import { syncDataset } from "./services/dataset.js";
import type { CatalogDatabase } from "./services/catalog-db.js";
import type { RatingsStore } from "./services/ratings-store.js";

const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function createApp(store: RatingsStore, catalog: CatalogDatabase, stop?: () => void): express.Express {
  const app = express();
  if (serviceConfig) app.use(runtimeAuth(serviceConfig.token));
  if (stop) app.post("/internal/shutdown", runtimeAuth(process.env.RESCORE_CONTROL_TOKEN ?? ""), (_req, res) => {
    res.json({ ok: true });
    setImmediate(stop);
  });
  app.use((_req, res, next) => {
    if (shutdownSignal.aborted) { res.status(503).json({ error: "Catalogue is stopping" }); return; }
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || localhost.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed"));
      },
    }),
  );
  app.use(express.json({ limit: "15mb" }));
  app.use(requestLog);

  app.use("/health", healthRouter(store, catalog));
  app.use("/ratings", ratingsRouter(store));
  app.use("/v1", v1Router(catalog, store));
  app.use("/v1/catalog/hydration", createHydrationEventsRouter());
  app.post("/sync", async (_req, res, next) => {
    try {
      await syncDataset(store, true);
      res.json({
        ok: true,
        ready: store.ready(),
        syncedAt: store.lastSyncedAt(),
        titleCount: store.titleCount(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}
