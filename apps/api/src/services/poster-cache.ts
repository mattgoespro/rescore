import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { emit } from "../log/write.js";

/** The poster cache keeps at most this much on disk. */
export const POSTER_CACHE_MAX_BYTES = 1024 ** 3;
/** A prune clears down to this share of the cap, so it runs rarely. */
const PRUNE_TO = 0.8;
/** New downloads between size checks. */
const DOWNLOADS_PER_CHECK = 500;

export interface CachedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * The files to delete, oldest download first, to bring the cache under the
 * prune target; none while it is within the cap.
 */
export function posterEvictions(
  files: readonly CachedFile[],
  maxBytes = POSTER_CACHE_MAX_BYTES,
): CachedFile[] {
  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxBytes) return [];
  const target = maxBytes * PRUNE_TO;
  const evicted: CachedFile[] = [];
  for (const file of [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= target) break;
    evicted.push(file);
    total -= file.size;
  }
  return evicted;
}

async function listImages(dir: string): Promise<CachedFile[]> {
  const files: CachedFile[] = [];
  const sizes = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of sizes) {
    if (!entry.isDirectory()) continue;
    const sizeDir = join(dir, entry.name);
    for (const name of await readdir(sizeDir).catch(() => [] as string[])) {
      // Images only; each one's ".complete" marker goes with it.
      if (name.endsWith(".complete") || name.endsWith(".tmp")) continue;
      const path = join(sizeDir, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile())
        files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  return files;
}

/** Deletes the oldest posters once the cache is over its cap. */
export async function prunePosterCache(
  dir: string,
  maxBytes = POSTER_CACHE_MAX_BYTES,
): Promise<number> {
  const evicted = posterEvictions(await listImages(dir), maxBytes);
  for (const file of evicted) {
    // The marker goes first, so a reader never trusts a half-deleted image.
    await unlink(`${file.path}.complete`).catch(() => undefined);
    await unlink(file.path).catch(() => undefined);
  }
  if (evicted.length)
    emit({
      channel: "posters",
      phase: "posters",
      level: "info",
      message: `Poster cache over ${Math.round(maxBytes / 1024 ** 2)} MB; removed ${evicted.length} oldest images`,
    });
  return evicted.length;
}

/**
 * Counts downloads and prunes the cache on the first one and every few
 * hundred after, one prune at a time.
 */
export function posterCacheKeeper(dir: string) {
  let downloads = 0;
  let running: Promise<unknown> | null = null;
  return {
    downloaded(): void {
      if (downloads++ % DOWNLOADS_PER_CHECK !== 0 || running) return;
      running = prunePosterCache(dir)
        .catch(() => undefined)
        .finally(() => {
          running = null;
        });
    },
  };
}
