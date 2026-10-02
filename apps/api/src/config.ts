import "./services/service-environment.js";
import { join } from "node:path";
import { BAKED_TMDB_API_KEYS } from "./tmdb-keys.local.js";

export const PORT = Number(process.env.PORT) || 3847;
export const IMDB_DATASETS_BASE =
  process.env.IMDB_DATASETS_BASE ?? "https://datasets.imdbws.com";
export const DATASET_URL =
  process.env.IMDB_RATINGS_URL ?? `${IMDB_DATASETS_BASE}/title.ratings.tsv.gz`;
export const DATA_DIR =
  process.env.IMDB_DATA_DIR ?? join(process.cwd(), "data");
export const DATASET_FILE = "title.ratings.tsv.gz";
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_RATING_IDS = 200;
export const CATALOG_DB_PATH =
  process.env.CATALOG_DB_PATH ?? join(DATA_DIR, "catalog.sqlite");
export const POSTER_CACHE_DIR =
  process.env.POSTER_CACHE_DIR ?? join(DATA_DIR, "posters");
export const TMDB_API_BASE =
  process.env.TMDB_API_BASE ?? "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE =
  process.env.TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p/w342";

export function tmdbApiKeys(
  raw?: string,
  legacy?: string,
  baked: readonly string[] = BAKED_TMDB_API_KEYS,
): string[] {
  const source =
    raw !== undefined ? raw : legacy !== undefined ? legacy : baked.join("\n");
  return [
    ...new Set(
      source
        .split(/\r?\n/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

export const TMDB_API_KEYS = tmdbApiKeys(
  process.env.TMDB_API_KEYS,
  process.env.TMDB_API_KEY,
);

export function tmdbConcurrency(
  raw: string | undefined = process.env.TMDB_CONCURRENCY,
): number {
  return Math.max(1, Math.floor(Number(raw) || 8));
}

export function tmdbMaxConcurrency(
  raw: string | undefined = process.env.TMDB_MAX_CONCURRENCY,
): number {
  return Math.max(1, Math.floor(Number(raw) || 32));
}

export function tmdbRequestsPerSecond(
  raw: string | undefined = process.env.TMDB_REQUESTS_PER_SECOND,
): number {
  return Math.max(0.1, Number(raw) || 40);
}

export const TMDB_CONCURRENCY = tmdbConcurrency();
export const TMDB_MAX_CONCURRENCY = tmdbMaxConcurrency();
export const TMDB_REQUESTS_PER_SECOND = tmdbRequestsPerSecond();
export const TMDB_POSTER_PAGE_SIZE = Math.max(
  50,
  Number(process.env.TMDB_POSTER_PAGE) || 400,
);
