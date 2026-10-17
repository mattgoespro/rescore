export type ThemeMode = "dark" | "light";

export const DEFAULT_ACCENT_COLOR = "#CEAA34";

export const THEME_CANVAS = {
  dark: "#0e0e10",
  light: "#f3f3f5",
} as const;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const APPEARANCE_KEYS = new Set(["themeMode", "accentColor"]);

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function parseAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  const match = HEX.exec(hex);
  if (!match) return null;
  const digits = match[1];
  if (digits.length === 3) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`.toUpperCase();
  }
  return `#${digits.toUpperCase()}`;
}

export function normalizeAccentColor(value: unknown): string {
  return parseAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}

export function isAppearanceOnlyPatch(patch: object): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => APPEARANCE_KEYS.has(key));
}

export function accentInkColor(hex: string): string {
  const background = relativeLuminance(normalizeAccentColor(hex));
  const dark = "#1A0C06";
  const light = "#FFF8F2";
  const contrast = (foreground: string): number => {
    const luminance = relativeLuminance(foreground);
    return (
      (Math.max(background, luminance) + 0.05) /
      (Math.min(background, luminance) + 0.05)
    );
  };
  const chosen = contrast(dark) >= contrast(light) ? dark : light;
  if (contrast(chosen) >= 4.5) return chosen;
  return contrast("#000000") >= contrast("#FFFFFF") ? "#000000" : "#FFFFFF";
}

/** Keep accent text readable on the canvas, panels, and tinted selections. */
export function accentTextColor(hex: string, themeMode: ThemeMode): string {
  const accent = normalizeAccentColor(hex);
  const ink = themeMode === "light" ? "#17171B" : "#F5F5F7";
  const surfaces = [
    THEME_CANVAS[themeMode],
    themeMode === "light" ? "#FFFFFF" : "#17171B",
  ];
  const backgrounds = surfaces.flatMap((surface) => [
    surface,
    mixColor(surface, accent, 0.14),
  ]);
  for (let step = 0; step <= 100; step++) {
    const candidate = mixColor(accent, ink, step / 100);
    const foreground = relativeLuminance(candidate);
    if (
      backgrounds.every((background) => {
        const luminance = relativeLuminance(background);
        return (
          (Math.max(foreground, luminance) + 0.05) /
            (Math.min(foreground, luminance) + 0.05) >=
          4.5
        );
      })
    )
      return candidate;
  }
  return ink;
}

function mixColor(from: string, to: string, amount: number): string {
  const a = rgb(from),
    b = rgb(to);
  return `#${(["r", "g", "b"] as const)
    .map((key) =>
      Math.round(a[key] * (1 - amount) + b[key] * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

export function windowSymbolColor(
  accent: string,
  themeMode: ThemeMode,
): string {
  const color = normalizeAccentColor(accent);
  const contrast = Math.abs(
    relativeLuminance(color) - relativeLuminance(THEME_CANVAS[themeMode]),
  );
  if (contrast > 0.22) return color;
  return themeMode === "light" ? "#17171B" : "#F5F5F7";
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const n = hex.slice(1);
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}
