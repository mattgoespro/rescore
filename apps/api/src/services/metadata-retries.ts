import type { CatalogDatabase } from "./catalog-db.js";
import { cancellableDelay, shutdownSignal } from "./runtime-lifecycle.js";

export const METADATA_RETRY_INTERVAL_MS = 7 * 24 * 60 * 60_000;
export const METADATA_RETRY_POLL_MS = 5 * 60_000;
export const METADATA_RETRY_BATCH_SIZE = 400;

/** Wait between bounded retry batches, including when upgrading a catalogue of legacy misses. */
export async function runMetadataRetries(
  catalog: CatalogDatabase,
  hydrate: (ids: string[]) => Promise<void>,
  canRetry: () => boolean,
  options: {
    signal?: AbortSignal;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<void> {
  const signal = options.signal ?? shutdownSignal;
  const wait = options.wait ?? ((ms) => cancellableDelay(ms, { unref: true }));
  const now = options.now ?? Date.now;
  try {
    while (!signal.aborted) {
      await wait(METADATA_RETRY_POLL_MS);
      if (signal.aborted) return;
      if (!canRetry()) continue;
      const ids = catalog.requeueMissingMedia(
        now() - METADATA_RETRY_INTERVAL_MS,
        METADATA_RETRY_BATCH_SIZE,
      );
      if (ids.length) await hydrate(ids);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
