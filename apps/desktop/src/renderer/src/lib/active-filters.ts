import type { DiscoverFilters } from "../../../shared/types";
import { defaultFilters } from "../../../shared/types";

/**
 * Filter-panel criteria that differ from a fresh search. The top-bar query
 * and the sort order are not filters, so neither counts.
 */
export function activeFilterCount(filters: DiscoverFilters): number {
  const base = defaultFilters();
  const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean =>
    a.length === b.length && a.every((value) => b.includes(value));
  return [
    filters.titleKind !== base.titleKind,
    filters.genres.length > 0,
    filters.withoutGenres.length > 0,
    !sameList(filters.excludeLanguages, base.excludeLanguages),
    filters.yearMin !== base.yearMin || filters.yearMax !== base.yearMax,
    filters.ratingMin !== base.ratingMin,
    filters.voteCountMin !== base.voteCountMin,
    filters.runtimeMin !== base.runtimeMin ||
      filters.runtimeMax !== base.runtimeMax,
    filters.hideWatched !== base.hideWatched,
    filters.hideWatchlist !== base.hideWatchlist,
  ].filter(Boolean).length;
}
