export type WatchStatus = "watched" | "watchlist" | "skipped";
export type MediaType = "movie" | "tv";
export type TitleKind = "movie" | "tv" | "miniseries";

export interface Genre {
  id: number;
  name: string;
}

export interface PersonRef {
  id: number;
  name: string;
}

export interface KeywordRef {
  id: number;
  name: string;
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

/** UI adapter over TitleDto. Catalog-only fields stay empty. */
export interface MovieSummary {
  imdbId: string;
  mediaType: MediaType;
  titleKind: TitleKind;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string;
  year?: number;
  genreIds: number[];
  originalLanguage: string;
  popularity: number;
  voteAverage: number;
  voteCount: number;
  adult: boolean;
  runtime?: number;
  certification?: string;
  directorIds?: number[];
  directorNames?: string[];
  castIds?: number[];
  castNames?: string[];
  seasonCount?: number;
  episodeCount?: number;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  order: number;
  profilePath: string | null;
}

export interface MovieDetails extends MovieSummary {
  runtime?: number;
  tagline?: string;
  status?: string;
  budget?: number;
  revenue?: number;
  homepage?: string;
  genres: Genre[];
  directors: PersonRef[];
  cast: CastMember[];
  keywords: KeywordRef[];
}

export interface LibraryEntry {
  imdbId: string;
  mediaType: MediaType;
  titleKind: TitleKind;
  title: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  year?: number;
  genreIds: number[];
  runtime?: number;
  certification?: string;
  originalLanguage?: string;
  voteAverage: number;
  voteCount: number;
  directorIds: number[];
  directorNames: string[];
  castIds: number[];
  castNames: string[];
  status: WatchStatus;
  rating?: number;
  ratedAt?: string;
  watchedAt?: string;
  updatedAt: string;
}

export function mediaTypeOf(kind?: TitleKind | MediaType): MediaType {
  return kind === "tv" || kind === "miniseries" ? "tv" : "movie";
}

export function titleKey(title: {
  imdbId: string;
  mediaType?: MediaType;
}): string {
  return title.imdbId.toLowerCase();
}

export function titleKindLabel(kind?: TitleKind): string {
  if (kind === "tv") return "TV Series";
  if (kind === "miniseries") return "Mini-Series";
  return "Movie";
}

export function formatSeasons(count?: number): string | null {
  if (!count || count <= 0) return null;
  return count === 1 ? "1 season" : `${count} seasons`;
}

export function formatRuntime(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

export function formatVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return `${n}`;
}

export function imdbUrl(imdbId?: string): string | null {
  if (!imdbId) return null;
  return `https://www.imdb.com/title/${imdbId}/`;
}

export function yearOf(date?: string): number | undefined {
  if (!date || date.length < 4) return undefined;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

export function sortMovies<T extends MovieSummary & { match?: number }>(
  movies: T[],
  sortBy: string,
): T[] {
  const compare = movieComparator(sortBy);
  if (!compare) return [...movies];
  return [...movies].sort(compare);
}

function movieComparator(
  sortBy: string,
):
  | ((
      a: MovieSummary & { match?: number },
      b: MovieSummary & { match?: number },
    ) => number)
  | null {
  const byId = (a: MovieSummary, b: MovieSummary): number =>
    titleKey(a).localeCompare(titleKey(b));
  switch (sortBy) {
    case "match":
      return (a, b) =>
        n(b.match) - n(a.match) ||
        n(b.voteAverage) - n(a.voteAverage) ||
        n(b.voteCount) - n(a.voteCount) ||
        byId(a, b);
    case "vote_average.desc":
      return (a, b) =>
        ratingTenths(b.voteAverage) - ratingTenths(a.voteAverage) ||
        n(b.voteCount) - n(a.voteCount) ||
        n(b.voteAverage) - n(a.voteAverage) ||
        byId(a, b);
    case "vote_count.desc":
      return (a, b) =>
        n(b.voteCount) - n(a.voteCount) ||
        n(b.voteAverage) - n(a.voteAverage) ||
        byId(a, b);
    case "popularity.desc":
      return (a, b) => n(b.voteCount) - n(a.voteCount) || byId(a, b);
    case "primary_release_date.desc":
      return (a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || "") || byId(a, b);
    case "primary_release_date.asc":
      return (a, b) =>
        (a.releaseDate || "").localeCompare(b.releaseDate || "") || byId(a, b);
    default:
      return null;
  }
}

function n(value: unknown): number {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function ratingTenths(value: unknown): number {
  return Math.round(n(value) * 10);
}
