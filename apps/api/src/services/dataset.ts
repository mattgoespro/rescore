import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, DATASET_FILE, DATASET_URL } from "../config.js";
import type { ImdbRating } from "../types.js";
import type { RatingsStore } from "./ratings-store.js";
import { ensureGzipFile, imdbValue, isStale, readTsvRows } from "./gzip-tsv.js";

const IMDB_ID = /^tt\d+$/i;

let inflight: Promise<void> | null = null;

export function datasetPath(): string {
  return join(DATA_DIR, DATASET_FILE);
}

export function syncDataset(store: RatingsStore, force = false): Promise<void> {
  if (inflight) return inflight;
  inflight = ensureDataset(store, force).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function ensureDataset(
  store: RatingsStore,
  force: boolean,
): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = datasetPath();
  const present = existsSync(file);

  if (present && !store.ready()) {
    await loadFromFile(store, file, false);
  }

  if (!force && present && !isStale(file) && store.ready()) return;

  try {
    await ensureGzipFile(DATASET_URL, file, false);
    await loadFromFile(store, file, true);
  } catch (error) {
    if (store.ready()) {
      console.warn(
        "IMDb ratings refresh failed; keeping the last loaded dataset.",
        error,
      );
      return;
    }
    throw error;
  }
}

async function loadFromFile(
  store: RatingsStore,
  file: string,
  persist: boolean,
): Promise<void> {
  const ratings = await parseRatingsTsv(file);
  if (!ratings.size) throw new Error("IMDb ratings file parsed empty");
  store.replace(ratings, new Date().toISOString(), persist);
}

export async function parseRatingsTsv(
  file: string,
): Promise<Map<string, ImdbRating>> {
  const ratings = new Map<string, ImdbRating>();
  for await (const [tconst, averageRating, numVotes] of readTsvRows(file)) {
    const id = imdbValue(tconst)?.toLowerCase();
    if (!id || !IMDB_ID.test(id)) continue;
    const rating = Number(averageRating);
    const votes = Number(numVotes);
    if (!Number.isFinite(rating) || !Number.isFinite(votes)) continue;
    ratings.set(id, { rating, votes });
  }
  return ratings;
}
