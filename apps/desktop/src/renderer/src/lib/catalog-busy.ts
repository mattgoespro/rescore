const FIRST_BUILD_DETAIL =
  "IMDb’s non-commercial datasets are several hundred MB. Your ratings, watchlist, and skips are kept.";
const BACKGROUND_CHECK_DETAIL =
  "Looking for catalogue updates. You can keep using the current titles.";

const REBUILD_FALLBACK = "Rebuilding catalog…";

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
  } | null,
): boolean {
  if (!status) return true;
  if (status.phase === "error") return false;
  if (status.titlesReady || status.titleCount > 0) return false;
  return status.phase === "starting" || status.phase === "building";
}

export function catalogLoaderDetail(
  status: {
    phase: string;
    titlesReady?: boolean;
    titleCount: number;
    download?: { receivedBytes: number } | null;
  } | null,
): string | undefined {
  if (!status) return undefined;
  const hasCatalog = Boolean(status.titlesReady || status.titleCount > 0);
  if (hasCatalog) {
    return (status.download?.receivedBytes ?? 0) > 0
      ? undefined
      : BACKGROUND_CHECK_DETAIL;
  }
  if (status.phase === "building") return FIRST_BUILD_DETAIL;
  return undefined;
}
