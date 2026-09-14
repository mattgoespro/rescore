import {
  accentInkColor,
  normalizeAccentColor,
  normalizeThemeMode,
} from "../../../shared/appearance";
import type { Settings } from "../../../shared/types";

const CACHE_KEY = "rescore.appearance";

export function applyAppearance(
  input: Pick<Settings, "themeMode" | "accentColor">,
): void {
  const themeMode = normalizeThemeMode(input.themeMode);
  const accentColor = normalizeAccentColor(input.accentColor);
  const root = document.documentElement;
  root.dataset.theme = themeMode;
  root.classList.toggle("dark", themeMode === "dark");
  root.style.colorScheme = themeMode;
  root.style.setProperty("--imd-accent", accentColor);
  root.style.setProperty("--imd-accent-ink", accentInkColor(accentColor));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ themeMode, accentColor }));
  } catch {
    /* ignore quota / blocked storage */
  }
}

export function applyCachedAppearance(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      themeMode?: unknown;
      accentColor?: unknown;
    };
    applyAppearance({
      themeMode: normalizeThemeMode(parsed.themeMode),
      accentColor: normalizeAccentColor(parsed.accentColor),
    });
  } catch {
    /* ignore invalid cache */
  }
}
