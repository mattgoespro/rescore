import { CATALOG_DB_PATH, DATA_DIR, PORT, SYNC_INTERVAL_MS } from "./config.js";
import { createApp } from "./app.js";
import { syncDataset } from "./services/dataset.js";
import { CatalogDatabase } from "./services/catalog-db.js";
import { ensureCatalog, refreshCatalogStatus } from "./services/ensure-catalog.js";
import { cleanupIncompleteDownloads } from "./services/gzip-tsv.js";
import { emit } from "./log/write.js";
import { RatingsStore } from "./services/ratings-store.js";

function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack =
    process.env.LOG_LEVEL === "debug" && error instanceof Error && error.stack
      ? ` ${error.stack}`
      : "";
  return `${message}${stack}`;
}

cleanupIncompleteDownloads(DATA_DIR);

const catalog = new CatalogDatabase(CATALOG_DB_PATH);
const store = new RatingsStore(catalog);
const app = createApp(store, catalog);
const server = app.listen(PORT, () => {
  emit({
    channel: "api",
    phase: "startup",
    level: "info",
    message: `IMDb catalog API listening on http://127.0.0.1:${PORT}`,
  });
});
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

void ensureCatalog(catalog)
  .then((built) => {
    if (built) {
      emit({
        channel: "catalog",
        phase: "startup",
        level: "info",
        message: `Built ${built.titleCount.toLocaleString()} titles at ${built.builtAt}`,
      });
    }
    void syncDataset(store)
      .then(() => {
        emit({
          channel: "ratings",
          phase: "startup",
          level: "info",
          message: `Ratings ready (${store.titleCount().toLocaleString()} titles, synced ${store.lastSyncedAt()})`,
        });
      })
      .catch((error: unknown) => {
        emit({
          channel: "ratings",
          phase: "startup",
          level: "warn",
          message: `Ratings sync failed. ${failureText(error)}`,
        });
      });
  })
  .catch((error: unknown) => {
    emit({
      channel: "catalog",
      phase: "startup",
      level: "error",
      message: `Catalog startup failed. ${failureText(error)}`,
    });
  });

setInterval(() => {
  void syncDataset(store).catch((error: unknown) => {
    emit({
      channel: "ratings",
      phase: "startup",
      level: "warn",
      message: `Scheduled IMDb ratings refresh failed. ${failureText(error)}`,
    });
  });
}, SYNC_INTERVAL_MS).unref();

function shutdown(signal: string): void {
  emit({
    channel: "api",
    phase: "shutdown",
    level: "info",
    message: `Catalog API stopping (${signal})`,
  });
  server.close(() => {
    try {
      catalog.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  setTimeout(() => {
    try {
      catalog.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  }, 1500).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
