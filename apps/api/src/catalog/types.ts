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
  votesMin?: number;
  hideWatched?: boolean;
  hideWatchlist?: boolean;
  genres?: string[];
  runtimeMin?: number;
  runtimeMax?: number;
  includeTotal?: boolean;
}

export interface CatalogMeta {
  builtAt: string | null;
  revision: string | null;
  source: string | null;
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
  imdb_rating: number | null;
  imdb_votes: number | null;
}

export const IMDB_ID = /^tt\d+$/i;
