import { languageName } from "../../../shared/languages";
import type { DiscoverFilters, Genre } from "../../../shared/types";
import { defaultFilters, mediaTypeOf } from "../../../shared/types";
import {
  runtimeCaption,
  yearCaption,
} from "../components/filter-panel/captions";
import {
  RUNTIME_CEILING,
  RUNTIME_FLOOR,
  YEAR_CEILING,
  YEAR_FLOOR,
} from "../components/filter-panel/constants";

export type FilterFieldId =
  | "genres"
  | "released"
  | "quality"
  | "languages"
  | "library"
  | "runtime"
  | "directors"
  | "cast";

export type FilterGroup = "Content" | "People" | "Quality" | "Library";

/**
 * One filter in the Discover bar. Pinned fields always show as a pill; the
 * rest wait in "Add filter" until added or set, so a new field costs one
 * menu entry until someone uses it. Type, sort and the query are view
 * controls, not filters, and are never fields here.
 */
export interface FilterFieldSpec {
  id: FilterFieldId;
  /** Pill label, read before the summary ("Genres", "Hiding"). */
  label: string;
  /** Name in "Add filter" and in the editor's accessible label. */
  name: string;
  group: FilterGroup;
  pinned: boolean;
  changed: (filters: DiscoverFilters) => boolean;
  /** The whole setting, for the pill's tooltip and accessible name. */
  summary: (filters: DiscoverFilters, genres: readonly Genre[]) => string;
  /**
   * For fields that both include and exclude: the pill shows `lead`, which
   * may truncate, then the excluded values pinned after it so a long lead
   * can never push them out of view.
   */
  exclusionTail?: (
    filters: DiscoverFilters,
    genres: readonly Genre[],
  ) => { lead: string; excluded: string[] };
  /** The filter values that put this field back to its default. */
  clear: () => Partial<DiscoverFilters>;
}

const base = defaultFilters();

/** Range ends at or past the slider's limit mean "no limit", stored or not. */
function sameRange(
  a: [number | null, number | null],
  b: [number | null, number | null],
  floor: number,
  ceiling: number,
): boolean {
  const low = (v: number | null) => (v == null || v <= floor ? floor : v);
  const high = (v: number | null) => (v == null || v >= ceiling ? ceiling : v);
  return low(a[0]) === low(b[0]) && high(a[1]) === high(b[1]);
}

function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function shortList(names: string[]): string {
  return names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

function genreNames(ids: number[], genres: readonly Genre[]): string[] {
  const names = new Map(genres.map((genre) => [genre.id, genre.name]));
  return ids.map((id) => names.get(id) ?? `Genre ${id}`);
}

export const FILTER_FIELDS: readonly FilterFieldSpec[] = [
  {
    id: "genres",
    label: "Genres",
    name: "Genres",
    group: "Content",
    pinned: true,
    changed: (f) => f.genres.length > 0 || f.withoutGenres.length > 0,
    summary: (f, genres) => {
      const parts: string[] = [];
      if (f.genres.length) parts.push(genreNames(f.genres, genres).join(", "));
      if (f.withoutGenres.length)
        parts.push(`not ${genreNames(f.withoutGenres, genres).join(", ")}`);
      return parts.length ? parts.join("; ") : "Any";
    },
    exclusionTail: (f, genres) => ({
      lead: f.genres.length ? genreNames(f.genres, genres).join(", ") : "Any",
      excluded: genreNames(f.withoutGenres, genres),
    }),
    clear: () => ({ genres: [], withoutGenres: [] }),
  },
  {
    id: "released",
    label: "Released",
    name: "Release year",
    group: "Content",
    pinned: true,
    changed: (f) =>
      !sameRange(
        [f.yearMin, f.yearMax],
        [base.yearMin, base.yearMax],
        YEAR_FLOOR,
        YEAR_CEILING,
      ),
    summary: (f) => yearCaption(f.yearMin, f.yearMax),
    clear: () => ({ yearMin: base.yearMin, yearMax: base.yearMax }),
  },
  {
    id: "quality",
    label: "Quality",
    name: "Quality floor",
    group: "Quality",
    pinned: true,
    changed: (f) =>
      f.ratingMin !== base.ratingMin ||
      f.ratingMax !== base.ratingMax ||
      f.voteCountMin !== base.voteCountMin,
    summary: (f) =>
      `${f.ratingMin > 0 ? `IMDb ${f.ratingMin.toFixed(1)}+` : "Any rating"}, ${
        f.voteCountMin > 0
          ? `${compactCount(f.voteCountMin)}+ votes`
          : "any votes"
      }`,
    clear: () => ({
      ratingMin: base.ratingMin,
      ratingMax: base.ratingMax,
      voteCountMin: base.voteCountMin,
    }),
  },
  {
    id: "languages",
    label: "Hiding",
    name: "Languages",
    group: "Content",
    pinned: true,
    changed: (f) => !sameSet(f.excludeLanguages, base.excludeLanguages),
    summary: (f) =>
      f.excludeLanguages.length === 0
        ? "no languages"
        : f.excludeLanguages.length === 1
          ? languageName(f.excludeLanguages[0]!)
          : `${f.excludeLanguages.length} languages`,
    clear: () => ({ excludeLanguages: [...base.excludeLanguages] }),
  },
  {
    id: "library",
    label: "Hiding",
    name: "Your library",
    group: "Library",
    pinned: true,
    changed: (f) =>
      f.hideWatched !== base.hideWatched ||
      f.hideWatchlist !== base.hideWatchlist,
    summary: (f) =>
      f.hideWatched && f.hideWatchlist
        ? "watched and watchlist"
        : f.hideWatched
          ? "watched"
          : f.hideWatchlist
            ? "watchlist"
            : "none of your library",
    clear: () => ({
      hideWatched: base.hideWatched,
      hideWatchlist: base.hideWatchlist,
    }),
  },
  {
    id: "runtime",
    label: "Runtime",
    name: "Runtime",
    group: "Content",
    pinned: false,
    changed: (f) =>
      !sameRange(
        [f.runtimeMin, f.runtimeMax],
        [base.runtimeMin, base.runtimeMax],
        RUNTIME_FLOOR,
        RUNTIME_CEILING,
      ),
    summary: (f) => runtimeCaption(f.runtimeMin, f.runtimeMax),
    clear: () => ({ runtimeMin: base.runtimeMin, runtimeMax: base.runtimeMax }),
  },
  {
    id: "directors",
    label: "Director",
    name: "Director",
    group: "People",
    pinned: false,
    changed: (f) => f.directors.length > 0,
    summary: (f) => (f.directors.length ? shortList(f.directors) : "Anyone"),
    clear: () => ({ directors: [] }),
  },
  {
    id: "cast",
    label: "Cast",
    name: "Cast",
    group: "People",
    pinned: false,
    changed: (f) => f.cast.length > 0,
    summary: (f) => (f.cast.length ? shortList(f.cast) : "Anyone"),
    clear: () => ({ cast: [] }),
  },
];

/** "Episode length" for TV, where runtime is per episode. */
export function fieldLabel(
  field: FilterFieldSpec,
  filters: DiscoverFilters,
): string {
  return field.id === "runtime" && mediaTypeOf(filters.titleKind) === "tv"
    ? "Episode length"
    : field.label;
}

/** Filters that differ from a fresh search; type, sort and query never count. */
export function activeFilterCount(filters: DiscoverFilters): number {
  return FILTER_FIELDS.filter((field) => field.changed(filters)).length;
}

/** Pills to show: pinned fields, plus any optional field set or just added. */
export function visibleFields(
  filters: DiscoverFilters,
  added: ReadonlySet<FilterFieldId>,
): FilterFieldSpec[] {
  return FILTER_FIELDS.filter(
    (field) => field.pinned || field.changed(filters) || added.has(field.id),
  );
}

export function addableFields(
  filters: DiscoverFilters,
  added: ReadonlySet<FilterFieldId>,
): FilterFieldSpec[] {
  const shown = new Set(visibleFields(filters, added).map((f) => f.id));
  return FILTER_FIELDS.filter((field) => !shown.has(field.id));
}

/** Every filter back to its default; the query, type and sort stay. */
export function resetFilters(filters: DiscoverFilters): DiscoverFilters {
  return FILTER_FIELDS.reduce<DiscoverFilters>(
    (next, field) => ({ ...next, ...field.clear() }),
    { ...filters, page: 1 },
  );
}
