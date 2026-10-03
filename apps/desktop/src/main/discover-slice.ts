import { languageQueryCodes } from "../shared/languages";
import type {
  DiscoverFilters,
  PagedMovies,
  RankedMovie,
} from "../shared/types";

export const DISCOVER_PAGE_SIZE = 40;

export function discoverQueryParams(
  filters: DiscoverFilters,
  names: { genres: string[]; withoutGenres: string[] },
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    page: filters.page,
    pageSize: DISCOVER_PAGE_SIZE,
    limit: DISCOVER_PAGE_SIZE,
    query: filters.query || undefined,
    kind: filters.titleKind === "miniseries" ? "miniseries" : filters.titleKind,
    yearMin: filters.yearMin ?? undefined,
    yearMax: filters.yearMax ?? undefined,
    ratingMin: filters.ratingMin || undefined,
    ratingMax: filters.ratingMax < 10 ? filters.ratingMax : undefined,
    votesMin: filters.voteCountMin || undefined,
    runtimeMin: filters.runtimeMin ?? undefined,
    runtimeMax: filters.runtimeMax ?? undefined,
    genre: names.genres.length ? names.genres.join(",") : undefined,
    withoutGenre: names.withoutGenres.length
      ? names.withoutGenres.join(",")
      : undefined,
    withoutLanguage: filters.excludeLanguages.length
      ? languageQueryCodes(filters.excludeLanguages).join(",")
      : undefined,
    hideWatched: filters.hideWatched ? "true" : undefined,
    hideWatchlist: filters.hideWatchlist ? "true" : undefined,
    sort: sortFor(filters.sortBy),
    order: orderFor(filters.sortBy),
    includeTotal: "false",
    cursor: filters.cursor ?? undefined,
  };
  for (const key of Object.keys(params)) {
    if (params[key] === undefined) delete params[key];
  }
  return params;
}

function sortFor(sort: string): string {
  if (sort.includes("vote_average")) return "rating";
  if (sort.includes("vote_count") || sort.includes("popularity"))
    return "votes";
  if (sort.includes("release_date")) return "year";
  return sort === "match" ? "votes" : "title";
}

function orderFor(sort: string): string {
  return sort.includes(".asc") ? "asc" : sort === "title" ? "asc" : "desc";
}

export async function loadDiscoverSlice(input: {
  filters: DiscoverFilters;
  mode: "replace" | "append";
  cursor: string | null;
  ratedCount: number;
  fetchPage: (filters: DiscoverFilters) => Promise<PagedMovies>;
  rankPage: (movies: RankedMovie[]) => RankedMovie[];
}): Promise<PagedMovies> {
  const filters: DiscoverFilters = {
    ...input.filters,
    page: 1,
    cursor: input.mode === "replace" ? null : input.cursor,
  };
  const fetched = await input.fetchPage(filters);
  const canLoadMore =
    fetched.results.length >= DISCOVER_PAGE_SIZE && fetched.nextCursor !== null;
  const results =
    filters.sortBy === "match" && input.ratedCount >= 3
      ? input.rankPage(fetched.results)
      : fetched.results;
  return {
    ...fetched,
    results,
    nextCursor: fetched.nextCursor,
    canLoadMore,
  };
}
