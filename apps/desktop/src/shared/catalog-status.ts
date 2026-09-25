export type CatalogPhase = "starting" | "building" | "ready" | "error";

export interface CatalogDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes: number | null;
}

/** In-memory TMDb hydration snapshot. `complete` is true only after durable writes. */
export interface TmdbHydrationProgress {
  processed: number;
  total: number;
  percent: number;
  message: string;
  complete: boolean;
}

export function tmdbHydrationPercent(
  processed: number,
  total: number,
  complete: boolean,
): number {
  if (complete) return 100;
  if (
    !Number.isFinite(processed) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    processed <= 0
  ) {
    return 0;
  }
  return Math.min(99, Math.floor((Math.min(processed, total) / total) * 100));
}

function nonNegativeInt(value: unknown): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

export function normalizeTmdbHydration(
  value?: Partial<TmdbHydrationProgress> | null,
): TmdbHydrationProgress {
  const processed = nonNegativeInt(value?.processed);
  const total = nonNegativeInt(value?.total);
  const complete = value?.complete === true;
  return {
    processed,
    total,
    percent: tmdbHydrationPercent(processed, total, complete),
    message: typeof value?.message === "string" ? value.message.trim() : "",
    complete,
  };
}

export function isTmdbDurablyComplete(
  status: { tmdbHydration?: { complete?: boolean } | null } | null,
): boolean {
  return status?.tmdbHydration?.complete === true;
}

export function isCatalogPollSettled(
  status: {
    phase: string;
    tmdbHydration?: { complete?: boolean } | null;
  } | null,
): boolean {
  if (!status) return false;
  if (status.phase === "error") return true;
  return status.phase === "ready" && isTmdbDurablyComplete(status);
}

export interface CatalogStatus {
  phase: CatalogPhase;
  message: string;
  titleCount: number;
  builtAt: string | null;
  error: string | null;
  download: CatalogDownloadProgress | null;
  titlesReady?: boolean;
  creditsReady?: boolean;
  titlesUpdateAvailable: boolean;
  creditsFailed: boolean;
  tmdbHydration: TmdbHydrationProgress;
}
