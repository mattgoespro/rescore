import {
  normalizeSearchHistory,
  SEARCH_HISTORY_LIMIT,
  searchHistoryKey,
  type SearchHistoryInput,
} from "../../../shared/search-history";
import type { SearchHistoryEntry } from "../../../shared/types";

const STORAGE_KEY = "rescore.searchHistory";

export function listSearchHistory(): SearchHistoryEntry[] {
  try {
    return normalizeSearchHistory(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

export function saveSearchHistory(
  input: SearchHistoryInput,
): SearchHistoryEntry[] {
  const current = listSearchHistory();
  const key = searchHistoryKey(input);
  const existing = current.find((entry) => searchHistoryKey(entry) === key);
  const next: SearchHistoryEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    titleKind: input.titleKind,
    genres: input.genres.map((genre) => ({ id: genre.id, name: genre.name })),
    yearMin: input.yearMin,
    yearMax: input.yearMax,
    ratingMin: input.ratingMin,
    sortBy: input.sortBy,
  };
  const history = [
    next,
    ...current.filter((entry) => entry.id !== next.id),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  writeHistory(history);
  return history;
}

export function removeSearchHistory(id: string): SearchHistoryEntry[] {
  const history = listSearchHistory().filter((entry) => entry.id !== id);
  writeHistory(history);
  return history;
}

function writeHistory(history: SearchHistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
