import type { TitleKind } from "./movie";
import type { LanguageCode } from "./languages";

export type AppView = "discover" | "foryou" | "library" | "settings";

export interface DiscoverFilters {
  query: string;
  titleKind: TitleKind;
  genres: number[];
  withoutGenres: number[];
  /** Original languages a title must have one of; empty means any. */
  languages: LanguageCode[];
  excludeLanguages: LanguageCode[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number;
  ratingMax: number;
  voteCountMin: number;
  runtimeMin: number | null;
  runtimeMax: number | null;
  sortBy: string;
  hideWatched: boolean;
  hideWatchlist: boolean;
  hideMissingPoster: boolean;
  hideMissingSynopsis: boolean;
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

// Every language IMDb lists for India, Pakistan, Bangladesh, and Sri Lanka.
// IMDb has no code for Kashmiri, Balochi, Saraiki, Brahui, Shina, Garo, or
// Chittagonian, so titles in those cannot be hidden by language.
const SOUTH_ASIAN_LANGUAGES: readonly LanguageCode[] = [
  // Major languages of India, Pakistan, Bangladesh, and Sri Lanka
  "ur",
  "pa",
  "ps",
  "sd",
  "bn",
  "si",
  "ta",
  "mr",
  "kn",
  "te",
  "gu",
  "hi",
  "ml",
  // Regional languages of India, Bangladesh, and Pakistan
  "as",
  "awa",
  "bho",
  "qbh",
  "hne",
  "doi",
  "gbm",
  "bgc",
  "kok",
  "mag",
  "mai",
  "mni",
  "ne",
  "or",
  "raj",
  "sa",
  "sat",
  "tcy",
  "ccp",
  "syl",
  "bsk",
  // Northeast India
  "adi",
  "apt",
  "mhu",
  "clk",
  "mjw",
  "kha",
  "trp",
  "mxj",
  "lus",
  "njb",
  "njz",
  "tgj",
  "nst",
  "nnp",
  // Himalayan India, with Tibetan
  "bee",
  "cdn",
  "drd",
  "jda",
  "lbj",
  "lif",
  "rnp",
  "sip",
  "bo",
  // Central, eastern, and southern India
  "bfw",
  "dso",
  "gbj",
  "hoc",
  "kyw",
  "qbl",
  "iru",
  "kfa",
  "saz",
  // Indian Sign Language and Parsi Gujarati
  "ins",
  "qaj",
];

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
    languages: [],
    excludeLanguages: [...SOUTH_ASIAN_LANGUAGES],
    sortBy: "match",
    hideWatched: true,
    hideWatchlist: false,
    hideMissingPoster: false,
    hideMissingSynopsis: false,
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
