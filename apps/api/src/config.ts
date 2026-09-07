import { join } from "node:path";

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
  process.env.TMDB_IMAGE_BASE ?? "https://image.tmdb.org/t/p/original";
export const TMDB_POSTER_CONCURRENCY = Math.max(
  1,
  Number(process.env.TMDB_CONCURRENCY) || 3,
);
export const TMDB_POSTER_PAGE_SIZE = Math.max(
  50,
  Number(process.env.TMDB_POSTER_PAGE) || 400,
);
