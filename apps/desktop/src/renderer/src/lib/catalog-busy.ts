const FIRST_BUILD_DETAIL =
  "IMDb’s non-commercial datasets are several hundred MB. Your ratings, watchlist, and skips are kept.";

const REBUILD_FALLBACK = "Rebuilding catalog…";

export function tmdbHealthPercent(
  filled: number,
  total: number,
): { label: string; width: number; value: number } {
  if (total <= 0 || filled <= 0) return { label: "0%", width: 0, value: 0 };
  const exact = (filled / total) * 100;
  const value = Math.round(exact);
  if (value === 0)
    return { label: "<1%", width: Math.max(exact, 0.8), value: 1 };
  return { label: `${value}%`, width: exact, value };
}

export function catalogRebuildFeedback(
  status: { phase: string; message?: string } | null,
): { label: string; button: string } | null {
  if (status?.phase !== "building") return null;
  return {
    label: status.message?.trim() || REBUILD_FALLBACK,
    button: "Rebuilding…",
  };
}

export function isCatalogUiBlocked(
  status: {
    phase: string;
    catalogUsable?: boolean;
  } | null,
): boolean {
  if (!status) return true;
  if (
    status.phase === "error" ||
    status.phase === "starting" ||
    status.phase === "building"
  ) {
    return true;
  }
  return status.catalogUsable !== true;
}

export function catalogLoaderDetail(
  status: {
    phase: string;
    titlesReady?: boolean;
    titleCount: number;
    download?: { receivedBytes: number } | null;
  } | null,
): string | undefined {
  if (!status || status.phase !== "building") return undefined;
  if (status.titlesReady) return undefined;
  if ((status.download?.receivedBytes ?? 0) > 0) return undefined;
  return FIRST_BUILD_DETAIL;
}

export type CatalogIndicatorState = "loaded" | "starting" | "failed";

export interface CatalogIndicator {
  state: CatalogIndicatorState;
  label: string;
  tip: string;
  detail: string;
}

/** Top-bar catalogue status: a word, a colour and a tooltip, never colour alone. */
export function catalogIndicator(
  status: {
    phase: string;
    catalogUsable?: boolean;
    message?: string;
    error?: string | null;
    tmdbHydration?: { complete: boolean; percent: number } | null;
  } | null,
): CatalogIndicator {
  if (status?.phase === "error") {
    return {
      state: "failed",
      label: "Failed",
      tip: "Catalogue has terminated",
      detail:
        status.error?.trim() ||
        status.message?.trim() ||
        "The catalogue failed to start or stopped unexpectedly.",
    };
  }
  if (isCatalogUiBlocked(status)) {
    return {
      state: "starting",
      label: "Starting",
      tip: "Catalogue is starting",
      detail:
        status?.message?.trim() ||
        "Searching and ranking unlock as soon as the catalogue is ready.",
    };
  }
  const hydration = status?.tmdbHydration;
  return {
    state: "loaded",
    label: "Loaded",
    tip: "Catalogue is running",
    detail:
      hydration && !hydration.complete
        ? `TMDb posters and synopses are still filling in (${hydration.percent}%).`
        : "Your local IMDb catalogue is loaded.",
  };
}
