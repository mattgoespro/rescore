export interface ImdbRating {
  rating: number;
  votes: number;
}

export interface TmdbHydrationProgress {
  completedIds?: string[];
  processed: number;
  total: number;
  percent: number;
  complete: boolean;
  message: string;
}

export interface HealthResponse {
  runtimeMode?: "service" | "app";
  protocolVersion?: number;
  catalogId?: string | null;
  runtimeVersion?: string | null;
  ok: boolean;
  ready: boolean;
  building: boolean;
  catalogPhase: "idle" | "building" | "ready" | "error";
  catalogMessage: string;
  catalogError: string | null;
  catalogDownload: CatalogDownloadProgress | null;
  syncedAt: string | null;
  titleCount: number;
  ratingsCount: number;
  catalogBuiltAt: string | null;
  catalogRevision: string | null;
  titlesReady?: boolean;
  creditsReady?: boolean;
  titlesUpdateAvailable: boolean;
  creditsFailed: boolean;
  catalogUsable: boolean;
  tmdbHydration: TmdbHydrationProgress;
}

export interface CatalogDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface RatingsResponse {
  syncedAt: string | null;
  ratings: Record<string, ImdbRating | null>;
}
