import type { MovieSummary } from "./movie";

export type RankingMode = "balanced" | "same" | "diverse";

export interface PagedMovies {
  page: number;
  totalPages: number;
  totalResults: number;
  results: RankedMovie[];
}

export interface RankReason {
  label: string;
  detail: string;
  weight: number;
}

export interface RankedMovie extends MovieSummary {
  match: number;
  reasons: RankReason[];
}

export interface MovieEnrichment {
  runtime?: number;
  certification?: string;
  directorIds?: number[];
  directorNames?: string[];
  castIds?: number[];
  castNames?: string[];
  seasonCount?: number;
  episodeCount?: number;
  imdbId?: string;
  voteAverage?: number;
  voteCount?: number;
  match?: number;
  reasons?: RankReason[];
}

export function applyMovieEnrichment(
  movie: RankedMovie,
  patch: MovieEnrichment,
): RankedMovie {
  return {
    ...movie,
    runtime: movie.runtime ?? patch.runtime,
    certification: movie.certification ?? patch.certification,
    directorIds: movie.directorIds?.length
      ? movie.directorIds
      : patch.directorIds,
    directorNames: movie.directorNames?.length
      ? movie.directorNames
      : patch.directorNames,
    castIds: movie.castIds?.length ? movie.castIds : patch.castIds,
    castNames: movie.castNames?.length ? movie.castNames : patch.castNames,
    seasonCount: movie.seasonCount ?? patch.seasonCount,
    episodeCount: movie.episodeCount ?? patch.episodeCount,
    imdbId: patch.imdbId ?? movie.imdbId,
    voteAverage: patch.voteAverage ?? movie.voteAverage,
    voteCount: patch.voteCount ?? movie.voteCount,
    match: patch.match ?? movie.match,
    reasons: patch.reasons ?? movie.reasons,
  };
}

export interface Affinity {
  id: string;
  name: string;
  weight: number;
  count: number;
  avg: number;
}

export interface TasteProfile {
  ratedCount: number;
  watchedCount: number;
  watchlistCount: number;
  skippedCount: number;
  globalAvg: number;
  runtimeMean: number;
  topGenres: Affinity[];
  topDecades: Affinity[];
  topDirectors: Affinity[];
  topCast: Affinity[];
  topLanguages: Affinity[];
  recentGenreIds: number[];
  ready: boolean;
}

export interface ForYouResult {
  profile: TasteProfile;
  insights: string[];
  movies: RankedMovie[];
}

export interface ImportProgress {
  current: number;
  total: number;
  title: string;
  imported: number;
  skipped: number;
  errors: number;
  done: boolean;
}
