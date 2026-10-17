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
  rankingMode: RankingMode;
  themeMode: ThemeMode;
  accentColor: string;
}

export const DEFAULT_CATALOG_API_URL = "http://127.0.0.1:3847";

export function defaultSettings(): Settings {
  return {
    catalogApiUrl: DEFAULT_CATALOG_API_URL,
    rankingMode: "balanced",
    themeMode: "dark",
    accentColor: DEFAULT_ACCENT_COLOR,
  };
}

export function normalizeSettings(
  raw?:
    | (Partial<Settings> & {
        tmdbApiKey?: unknown;
        tmdbApiKeys?: unknown;
        region?: unknown;
        imdbApiUrl?: unknown;
      })
    | null,
): Settings {
  const merged = { ...defaultSettings(), ...raw };
  return {
    catalogApiUrl: merged.catalogApiUrl,
    rankingMode: merged.rankingMode,
    themeMode: normalizeThemeMode(merged.themeMode),
    accentColor: normalizeAccentColor(merged.accentColor),
  };
}
