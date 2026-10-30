export interface ImdbRating {
  rating: number;
  votes: number;
}

export interface TmdbHydrationProgress {
  posters?: number;
  synopses?: number;
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
  catalogSetup?: CatalogSetupProgress | null;
  tmdbHydration: TmdbHydrationProgress;
}

export interface CatalogSetupFile {
  file: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
}

/**
 * Progress of the title steps that hold browsing: the title dumps download,
 * then indexing them. Present only while those steps run.
 */
export interface CatalogSetupProgress {
  step: "download" | "index";
  /** Both steps together, 0 to 1, weighted by how long each usually takes. */
  fraction: number;
  files: CatalogSetupFile[];
  bytesPerSecond: number | null;
  index: {
    stage: "pending" | "ratings" | "titles" | "finishing" | "done";
    /** The index step alone, 0 to 1. */
    fraction: number;
    titles: number;
  };
  /** Seconds left in the current step, once there is enough to estimate. */
  stepSecondsLeft: number | null;
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
