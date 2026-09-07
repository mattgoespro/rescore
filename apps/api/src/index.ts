import { CATALOG_DB_PATH, DATA_DIR, PORT, SYNC_INTERVAL_MS } from "./config.js";
import { createApp } from "./app.js";
import { syncDataset } from "./services/dataset.js";
import { CatalogDatabase } from "./services/catalog-db.js";
import { ensureCatalog, refreshCatalogStatus } from "./services/ensure-catalog.js";
import { cleanupIncompleteDownloads } from "./services/gzip-tsv.js";
import { RatingsStore } from "./services/ratings-store.js";
import { startPosterEnrichment } from "./services/tmdb-posters.js";

cleanupIncompleteDownloads(DATA_DIR);

const catalog = new CatalogDatabase(CATALOG_DB_PATH);
const store = new RatingsStore(catalog);
const app = createApp(store, catalog);
const server = app.listen(PORT, () => {
  console.log(`IMDb catalog API listening on http://127.0.0.1:${PORT}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Catalog API port ${PORT} is already in use.`);
  } else {
    console.error("Catalog API failed to listen.", error);
  }
  process.exit(1);
});

refreshCatalogStatus(catalog);

void ensureCatalog(catalog)
  .then((built) => {
    if (built) {
      console.log(
        `Built ${built.titleCount.toLocaleString()} titles at ${built.builtAt}`,
      );
    }
    void startPosterEnrichment(catalog);
    void syncDataset(store)
      .then(() => {
        console.log(
          `Ratings ready (${store.titleCount().toLocaleString()} titles, synced ${store.lastSyncedAt()})`,
        );
      })
      .catch((error: unknown) => {
        console.warn("Ratings sync failed.", error);
      });
  })
  .catch((error: unknown) => {
    console.error("Catalog startup failed.", error);
  });

setInterval(() => {
  void syncDataset(store).catch((error: unknown) => {
    console.warn("Scheduled IMDb ratings refresh failed.", error);
  });
}, SYNC_INTERVAL_MS).unref();

function shutdown(signal: string): void {
  console.log(`Catalog API stopping (${signal})`);
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
