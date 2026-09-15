import {
  defaultFilters,
  SORT_OPTIONS,
  titleKindLabel,
  type DiscoverFilters,
  type Genre,
  type SearchHistoryEntry,
  type SearchHistoryGenre,
  type TitleKind,
} from "./types";

export const SEARCH_HISTORY_LIMIT = 16;

export type SearchHistoryInput = Omit<SearchHistoryEntry, "id" | "savedAt">;

export function searchHistoryKey(entry: {
  titleKind: TitleKind;
  genres: Array<SearchHistoryGenre | number>;
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number;
  sortBy: string;
}): string {
  const ids = entry.genres
    .map((genre) => (typeof genre === "number" ? genre : genre.id))
    .sort((a, b) => a - b)
    .join(",");
  return `${entry.titleKind}|${ids}|${entry.yearMin ?? ""}|${entry.yearMax ?? ""}|${entry.ratingMin}|${entry.sortBy}`;
}

export function snapshotSearchHistory(
  filters: DiscoverFilters,
  genres: Genre[],
): SearchHistoryInput {
  const names = new Map(genres.map((genre) => [genre.id, genre.name]));
  return {
    titleKind: filters.titleKind,
    genres: filters.genres.map((id) => ({
      id,
      name: names.get(id) ?? `Genre ${id}`,
    })),
    yearMin: filters.yearMin,
    yearMax: filters.yearMax,
    ratingMin: filters.ratingMin,
    sortBy: filters.sortBy,
  };
}

export function isDefaultSearchHistory(snapshot: SearchHistoryInput): boolean {
  const defaults = defaultFilters();
  return (
    searchHistoryKey(snapshot) ===
    searchHistoryKey({
      titleKind: defaults.titleKind,
      genres: defaults.genres,
      yearMin: defaults.yearMin,
      yearMax: defaults.yearMax,
      ratingMin: defaults.ratingMin,
      sortBy: defaults.sortBy,
    })
  );
}

export function shouldRecordSearchHistory(options: {
  saved: boolean;
  snapshot: SearchHistoryInput;
}): boolean {
  if (options.saved) return false;
  return !isDefaultSearchHistory(options.snapshot);
}

export function upsertSearchHistory(
  current: SearchHistoryEntry[],
  input: SearchHistoryInput,
  now = new Date().toISOString(),
): SearchHistoryEntry[] {
  const key = searchHistoryKey(input);
  const existing = current.find((entry) => searchHistoryKey(entry) === key);
  const next: SearchHistoryEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    savedAt: now,
    titleKind: input.titleKind,
    genres: input.genres.map((genre) => ({ id: genre.id, name: genre.name })),
    yearMin: input.yearMin,
    yearMax: input.yearMax,
    ratingMin: input.ratingMin,
    sortBy: input.sortBy,
  };
  return [next, ...current.filter((entry) => entry.id !== next.id)].slice(
    0,
    SEARCH_HISTORY_LIMIT,
  );
}

export function applySearchHistory(
  filters: DiscoverFilters,
  entry: SearchHistoryEntry,
): DiscoverFilters {
  return {
    ...filters,
    titleKind: entry.titleKind,
    genres: entry.genres.map((genre) => genre.id),
    withoutGenres: [],
    yearMin: entry.yearMin,
    yearMax: entry.yearMax,
    ratingMin: entry.ratingMin,
    page: 1,
    sortBy:
      entry.titleKind !== "movie" && entry.sortBy === "revenue.desc"
        ? "popularity.desc"
        : entry.sortBy,
  };
}

export function matchesSearchHistory(
  filters: DiscoverFilters,
  entry: SearchHistoryEntry,
): boolean {
  return (
    searchHistoryKey({
      titleKind: filters.titleKind,
      genres: filters.genres,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      ratingMin: filters.ratingMin,
      sortBy: filters.sortBy,
    }) === searchHistoryKey(entry)
  );
}

export function historyTitleKindLabel(kind: TitleKind): string {
  if (kind === "movie") return "Movies";
  return titleKindLabel(kind);
}

export function historyGenresLabel(genres: SearchHistoryGenre[]): string {
  if (!genres.length) return "All genres";
  return genres.map((genre) => genre.name).join(", ");
}

export function historyYearsLabel(
  yearMin: number | null,
  yearMax: number | null,
): string {
  const now = new Date().getFullYear();
  const low = yearMin ?? 1900;
  const high = yearMax ?? now;
  if (
    (yearMin == null || yearMin <= 1900) &&
    (yearMax == null || yearMax >= now)
  )
    return "Any year";
  if (yearMin == null || yearMin <= 1900) return `Up to ${high}`;
  if (yearMax == null || yearMax >= now) return `${low} – ${now}`;
  if (low === high) return `${low}`;
  return `${low} – ${high}`;
}

export function historyRatingLabel(ratingMin: number): string {
  return `${ratingMin.toFixed(1)}+`;
}

export function historySortLabel(sortBy: string): string {
  return (
    SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy
  );
}

export function normalizeSearchHistory(raw: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: SearchHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Partial<SearchHistoryEntry>;
    if (typeof value.id !== "string" || !value.id) continue;
    if (
      value.titleKind !== "movie" &&
      value.titleKind !== "tv" &&
      value.titleKind !== "miniseries"
    ) {
      continue;
    }
    entries.push({
      id: value.id,
      savedAt:
        typeof value.savedAt === "string"
          ? value.savedAt
          : new Date().toISOString(),
      titleKind: value.titleKind,
      genres: normalizeGenres(value.genres),
      yearMin: numberOrNull(value.yearMin),
      yearMax: numberOrNull(value.yearMax),
      ratingMin:
        typeof value.ratingMin === "number" && Number.isFinite(value.ratingMin)
          ? value.ratingMin
          : 0,
      sortBy: normalizeSortBy(value.sortBy),
    });
  }
  return entries;
}

function normalizeGenres(raw: unknown): SearchHistoryGenre[] {
  if (!Array.isArray(raw)) return [];
  const genres: SearchHistoryGenre[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Partial<SearchHistoryGenre>;
    if (typeof value.id !== "number" || !Number.isFinite(value.id)) continue;
    genres.push({
      id: value.id,
      name:
        typeof value.name === "string" && value.name.trim()
          ? value.name
          : `Genre ${value.id}`,
    });
  }
  return genres;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSortBy(value: unknown): string {
  return typeof value === "string" &&
    SORT_OPTIONS.some((option) => option.value === value)
    ? value
    : "match";
}
