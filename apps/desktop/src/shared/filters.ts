import type { TitleKind } from "./movie";
import type { LanguageCode } from "./languages";

export type AppView = "discover" | "foryou" | "library" | "settings";

export interface DiscoverFilters {
  query: string;
  titleKind: TitleKind;
  genres: number[];
  withoutGenres: number[];
  excludeLanguages: LanguageCode[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number;
  ratingMax: number;
  voteCountMin: number;
  runtimeMin: number | null;
  runtimeMax: number | null;
  /** Credited directors by exact name; a title must match every one. */
  directors: string[];
  /** Credited cast by exact name; a title must match every one. */
  cast: string[];
  sortBy: string;
  hideWatched: boolean;
  hideWatchlist: boolean;
  page: number;
  cursor?: string | null;
}

export interface SearchHistoryGenre {
  id: number;
  name: string;
}

export interface SearchHistoryEntry {
  id: string;
  savedAt: string;
  titleKind: TitleKind;
  genres: SearchHistoryGenre[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number;
  sortBy: string;
  filters?: Omit<DiscoverFilters, "page" | "cursor">;
}

export const TITLE_KIND_OPTIONS = [
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Series" },
  { value: "miniseries", label: "Mini-Series" },
] as const;

export const SORT_OPTIONS = [
  { value: "vote_average.desc", label: "IMDb rating" },
  { value: "match", label: "Best match for you" },
  { value: "primary_release_date.desc", label: "Newest first" },
  { value: "primary_release_date.asc", label: "Oldest first" },
  { value: "popularity.desc", label: "Popularity" },
] as const;

export function defaultFilters(): DiscoverFilters {
  return {
    query: "",
    titleKind: "movie",
    genres: [],
    withoutGenres: [],
    yearMin: 2000,
    yearMax: new Date().getFullYear(),
    ratingMin: 7,
    ratingMax: 10,
    voteCountMin: 1000,
    runtimeMin: null,
    runtimeMax: null,
    directors: [],
    cast: [],
    // Major languages supported by the catalogue for Pakistan, Bangladesh,
    // and Sri Lanka: Urdu, Punjabi, Pashto, Sindhi, Bengali, Sinhala, Tamil.
    excludeLanguages: ["ur", "pa", "ps", "sd", "bn", "si", "ta"],
    sortBy: "match",
    hideWatched: true,
    hideWatchlist: false,
    page: 1,
  };
}

export function matchesRatingFilters(
  movie: { voteAverage: number; voteCount: number },
  filters: Pick<DiscoverFilters, "ratingMin" | "ratingMax" | "voteCountMin">,
): boolean {
  if (
    movie.voteAverage < filters.ratingMin ||
    movie.voteAverage > filters.ratingMax
  )
    return false;
  if (movie.voteCount < filters.voteCountMin) return false;
  return true;
}
