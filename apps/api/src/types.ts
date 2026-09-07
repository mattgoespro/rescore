export interface ImdbRating {
  rating: number;
  votes: number;
}

export interface HealthResponse {
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
