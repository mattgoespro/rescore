import type { KeywordRef, PersonRef, TitleKind } from "./movie";

export type AppView = "discover" | "foryou" | "library" | "settings";

export interface DiscoverFilters {
  query: string;
  titleKind: TitleKind;
  genres: number[];
  withoutGenres: number[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number;
  ratingMax: number;
  voteCountMin: number;
  runtimeMin: number | null;
  runtimeMax: number | null;
  language: string;
  cast: PersonRef[];
  directors: PersonRef[];
  keywords: KeywordRef[];
  providers: number[];
  sortBy: string;
  hideWatched: boolean;
  hideWatchlist: boolean;
  page: number;
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
}

export const LANGUAGES = [
  { code: "", label: "Any language" },
] as const;

export const TITLE_KIND_OPTIONS = [
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Series" },
  { value: "miniseries", label: "Mini-Series" },
] as const;

export const SORT_OPTIONS = [
  { value: "match", label: "Most voted" },
  { value: "popularity.desc", label: "Popularity" },
  { value: "vote_average.desc", label: "IMDb-style rating" },
  { value: "primary_release_date.desc", label: "Newest first" },
  { value: "primary_release_date.asc", label: "Oldest first" },
  { value: "vote_count.desc", label: "Most voted" },
] as const;

export function sortOptions(
  profileReady: boolean,
): Array<{ value: string; label: string }> {
  return SORT_OPTIONS.map((option) =>
    option.value === "match"
      ? {
          ...option,
          label: profileReady ? "Best match for you" : "Most voted",
        }
      : option,
  );
}

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
    language: "",
    cast: [],
    directors: [],
    keywords: [],
    providers: [],
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
