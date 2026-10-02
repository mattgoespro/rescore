import { CATALOG_DB_PATH, DATA_DIR, PORT, SYNC_INTERVAL_MS } from "./config.js";
import { createApp } from "./app.js";
import { syncDataset } from "./services/dataset.js";
import { CatalogDatabase } from "./services/catalog-db.js";
import {
  ensureCatalog,
  refreshCatalogStatus,
} from "./services/ensure-catalog.js";
import { cleanupIncompleteDownloads } from "./services/gzip-tsv.js";
import { emit } from "./log/write.js";
import { RatingsStore } from "./services/ratings-store.js";
import { serviceConfig } from "./services/service-environment.js";
import {
  drainWork,
  requestShutdown,
  shutdownSignal,
  cancellableDelay,
} from "./services/runtime-lifecycle.js";
import {
  catalogWorkQueue,
  mediaWorkQueue,
  maintenanceWorkQueue,
} from "./catalog/work-queue.js";
import { catalogStatus } from "./services/ensure-catalog.js";
import { retryDelay, permanentFailure } from "./services/service-retry.js";
import { closeHydrationEventStreams } from "./routes/hydration-events.js";

function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack =
    process.env.LOG_LEVEL === "debug" && error instanceof Error && error.stack
      ? ` ${error.stack}`
      : "";
  return `${message}${stack}`;
}

const catalog = new CatalogDatabase(CATALOG_DB_PATH);
cleanupIncompleteDownloads(DATA_DIR);
const store = new RatingsStore(catalog);
const app = createApp(store, catalog, () => {
  void shutdown("service control");
});
const onListen = (): void => {
  emit({
    channel: "api",
    phase: "startup",
    level: "info",
    message: `IMDb catalog API listening on http://127.0.0.1:${PORT}`,
  });
};
const server = serviceConfig
  ? app.listen(PORT, "127.0.0.1", onListen)
  : app.listen(PORT, onListen);
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    emit({
      channel: "api",
      phase: "startup",
      level: "error",
      message: `Catalog API port ${PORT} is already in use.`,
    });
  } else {
    emit({
      channel: "api",
      phase: "startup",
      level: "error",
      message: `Catalog API failed to listen. ${failureText(error)}`,
    });
  }
  process.exit(1);
});

refreshCatalogStatus(catalog);

let maintaining: Promise<void> | null = null;
function maintain(build: boolean): Promise<void> {
  if (maintaining) return maintaining;
  maintaining = initialize(build).finally(() => {
    maintaining = null;
  });
  return maintaining;
}
async function initialize(build: boolean): Promise<void> {
  let attempt = 0;
  while (!shutdownSignal.aborted) {
    try {
      if (build) {
        await ensureCatalog(catalog);
        const status = catalogStatus();
        if (serviceConfig && status.error) throw new Error(status.error);
        if (serviceConfig && catalog.creditsFailed())
          throw new Error("Credits import failed");
      }
      if (!shutdownSignal.aborted) await syncDataset(store);
      return;
    } catch (error) {
      if (shutdownSignal.aborted) return;
      emit({
        channel: "catalog",
        phase: "startup",
        level: "error",
        message: failureText(error),
      });
      if (!serviceConfig || permanentFailure(failureText(error))) return;
      try {
        await cancellableDelay(retryDelay(attempt++));
      } catch {
        return;
      }
    }
  }
}
void maintain(true);

const refreshTimer = setInterval(() => {
  void maintain(false).catch((error: unknown) => {
    emit({
      channel: "ratings",
      phase: "startup",
      level: "warn",
      message: `Scheduled IMDb ratings refresh failed. ${failureText(error)}`,
    });
  });
}, SYNC_INTERVAL_MS).unref();

async function shutdown(signal: string): Promise<void> {
  if (shutdownSignal.aborted) return;
  emit({
    channel: "api",
    phase: "shutdown",
    level: "info",
    message: `Catalog API stopping (${signal})`,
  });
  clearInterval(refreshTimer);
  requestShutdown();
  closeHydrationEventStreams();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const deadline = setTimeout(() => process.exit(1), 29_000);
  try {
    await drainWork();
    await Promise.all([
      catalogWorkQueue.drain(),
      mediaWorkQueue.drain(),
      maintenanceWorkQueue.drain(),
    ]);
    await closed;
    catalog.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) {
    emit({
      channel: "api",
      phase: "shutdown",
      level: "error",
      message: failureText(error),
    });
    process.exit(1);
  }
}
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
