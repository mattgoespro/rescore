import {
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
  normalizeThemeMode,
  type ThemeMode,
} from "./appearance";
import type { RankingMode } from "./ranking-types";

export type { ThemeMode } from "./appearance";

export interface Settings {
  catalogApiUrl: string;
  region: string;
  rankingMode: RankingMode;
  imdbApiUrl: string;
  tmdbApiKey: string;
  themeMode: ThemeMode;
  accentColor: string;
}

export const DEFAULT_CATALOG_API_URL = "http://127.0.0.1:3847";
/** @deprecated Use DEFAULT_CATALOG_API_URL. */
export const DEFAULT_IMDB_API_URL = DEFAULT_CATALOG_API_URL;

export function defaultSettings(): Settings {
  return {
    catalogApiUrl: DEFAULT_CATALOG_API_URL,
    region: "US",
    rankingMode: "balanced",
    imdbApiUrl: DEFAULT_CATALOG_API_URL,
    tmdbApiKey: "",
    themeMode: "dark",
    accentColor: DEFAULT_ACCENT_COLOR,
  };
}

export function normalizeSettings(raw?: Partial<Settings> | null): Settings {
  const merged = { ...defaultSettings(), ...raw };
  return {
    ...merged,
    tmdbApiKey:
      typeof merged.tmdbApiKey === "string" ? merged.tmdbApiKey.trim() : "",
    themeMode: normalizeThemeMode(merged.themeMode),
    accentColor: normalizeAccentColor(merged.accentColor),
  };
}
