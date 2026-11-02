import type { LibraryStatus } from "../catalog-types.js";

export interface CatalogTitleInput {
  id: string;
  title: string;
  originalTitle?: string | null;
  kind?: string;
  year?: number | null;
  runtimeMinutes?: number | null;
  synopsis?: string | null;
  posterUrl?: string | null;
  genres?: string[];
  directors?: string[];
  cast?: string[];
}

/** What the user's ratings favour, to widen For You past the most-voted titles. */
export interface ForYouHints {
  genres?: string[];
  /** Director names, as the library's credits spell them. */
  directors?: string[];
  /** First years of decades, such as 1990. */
  decades?: number[];
}

export interface TitleQuery {
  page: number;
  pageSize: number;
  sort: "title" | "year" | "rating" | "votes" | "updatedAt";
  order: "asc" | "desc";
  query?: string;
  genre?: string;
  kind?: string;
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  votesMin?: number;
  hideWatched?: boolean;
  hideWatchlist?: boolean;
  hideMissingPoster?: boolean;
  hideMissingSynopsis?: boolean;
  genres?: string[];
  withoutGenres?: string[];
  withoutLanguages?: string[];
  runtimeMin?: number;
  runtimeMax?: number;
  includeTotal?: boolean;
  cursor?: string;
}

export interface CatalogMeta {
  builtAt: string | null;
  revision: string | null;
  source: string | null;
}

/** TMDb hydration across the whole catalogue. */
export interface HydrationStats {
  total: number;
  processed: number;
  pending: number;
  complete: boolean;
}

export interface CatalogReadiness {
  titlesReady: boolean;
  creditsReady: boolean;
}

export interface LibraryRow {
  title_id: string;
  status: LibraryStatus;
  personal_rating: number | null;
  note: string | null;
  updated_at: string;
}

export interface CatalogTitleRow {
  id: string;
  title: string;
  originalTitle: string | null;
  kind: string;
  year: number | null;
  runtimeMinutes: number | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  genres: string[];
}

export interface CatalogPersonRow {
  titleId: string;
  nconst: string;
  name: string;
  role: "director" | "cast";
  position: number;
}

export interface TitleRow {
  id: string;
  title: string;
  original_title: string | null;
  kind: string;
  year: number | null;
  runtime_minutes: number | null;
  synopsis: string | null;
  poster_url: string | null;
  certification: string | null;
  imdb_rating: number | null;
  imdb_votes: number | null;
  updated_at: string;
}

export const IMDB_ID = /^tt\d+$/i;

export function personKey(name: string): string {
  const trimmed = name.trim();
  if (/^nm\d+$/i.test(trimmed)) return trimmed.toLowerCase();
  return `ex:${trimmed.toLowerCase()}`;
}
