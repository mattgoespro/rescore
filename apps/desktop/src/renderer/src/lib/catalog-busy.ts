import {
  isTmdbDurablyComplete,
  type TmdbHydrationProgress,
} from "../../../shared/catalog-status";

const FIRST_BUILD_DETAIL =
  "IMDb’s non-commercial datasets are several hundred MB. Your ratings, watchlist, and skips are kept.";
const BACKGROUND_CHECK_DETAIL =
  "Looking for catalogue updates. You can keep using the current titles.";

const REBUILD_FALLBACK = "Rebuilding catalog…";
const HYDRATION_LABEL = "Hydrating TMDb records…";

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
    titlesReady?: boolean;
    titleCount: number;
    tmdbHydration?: { complete?: boolean } | null;
  } | null,
): boolean {
  if (!status) return true;
  if (status.phase === "error") return false;
  const hasTitles = Boolean(status.titlesReady || status.titleCount > 0);
  if (!hasTitles) {
    return status.phase === "starting" || status.phase === "building";
  }
  return !isTmdbDurablyComplete(status);
}

export function catalogHydrationLabel(
  status: {
    phase: string;
    titlesReady?: boolean;
    titleCount: number;
    tmdbHydration?: { complete?: boolean } | null;
  } | null,
): string | null {
  if (!status || status.phase === "error") return null;
  const hasTitles = Boolean(status.titlesReady || status.titleCount > 0);
  if (!hasTitles || isTmdbDurablyComplete(status)) return null;
  return HYDRATION_LABEL;
}

export function catalogLoaderDetail(
  status: {
    phase: string;
    titlesReady?: boolean;
    titleCount: number;
    download?: { receivedBytes: number } | null;
    tmdbHydration?: { complete?: boolean; message?: string } | null;
  } | null,
): string | undefined {
  if (!status) return undefined;
  const hasCatalog = Boolean(status.titlesReady || status.titleCount > 0);
  if (hasCatalog && !isTmdbDurablyComplete(status)) {
    const message = status.tmdbHydration?.message?.trim() ?? "";
    return message || undefined;
  }
  if (hasCatalog) {
    return (status.download?.receivedBytes ?? 0) > 0
      ? undefined
      : BACKGROUND_CHECK_DETAIL;
  }
  if (status.phase === "building") return FIRST_BUILD_DETAIL;
  return undefined;
}

export function tmdbHydrationCaption(progress: {
  processed: number;
  total: number;
  percent: number;
}): string {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const processed = Math.max(0, Math.floor(progress.processed));
  const total = Math.max(0, Math.floor(progress.total));
  return `${percent}% · ${processed.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`;
}

export function visibleTmdbHydration(
  hydration: TmdbHydrationProgress | null | undefined,
): TmdbHydrationProgress | null {
  if (!hydration || hydration.complete) return null;
  if (hydration.total > 0 || hydration.message.trim().length > 0)
    return hydration;
  return null;
}
