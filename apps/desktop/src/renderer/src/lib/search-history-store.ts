import {
  normalizeSearchHistory,
  SEARCH_HISTORY_LIMIT,
  searchHistoryKey,
  upsertSearchHistory,
  type SearchHistoryInput,
} from "../../../shared/search-history";
import type { SearchHistoryEntry } from "../../../shared/types";

const STORAGE_KEY = "rescore.searchHistory";

function readLegacyHistory(): SearchHistoryEntry[] {
  try {
    return normalizeSearchHistory(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

export async function listSearchHistory(): Promise<SearchHistoryEntry[]> {
  const remote = await window.api.listSearchHistory();
  if (remote.length) {
    localStorage.removeItem(STORAGE_KEY);
    return remote.slice(0, SEARCH_HISTORY_LIMIT);
  }
  const legacy = readLegacyHistory();
  if (!legacy.length) return [];
  let next: SearchHistoryEntry[] = [];
  for (const entry of [...legacy].reverse()) {
    next = await window.api.saveSearchHistory(entry);
  }
  localStorage.removeItem(STORAGE_KEY);
  return next;
}

export async function saveSearchHistory(
  input: SearchHistoryInput,
): Promise<SearchHistoryEntry[]> {
  return window.api.saveSearchHistory(input);
}

export async function removeSearchHistory(
  id: string,
): Promise<SearchHistoryEntry[]> {
  return window.api.removeSearchHistory(id);
}

export { searchHistoryKey, upsertSearchHistory };
