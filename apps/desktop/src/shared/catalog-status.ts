export type CatalogPhase = "starting" | "building" | "ready" | "error";

export interface CatalogDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface CatalogSetupFile {
  file: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
}

/** The API's progress through the title steps that hold browsing. */
export interface CatalogSetupProgress {
  step: "download" | "index";
  /** Both steps together, 0 to 1. */
  fraction: number;
  files: CatalogSetupFile[];
  bytesPerSecond: number | null;
  index: {
    stage: "pending" | "ratings" | "titles" | "finishing" | "done";
    fraction: number;
    titles: number;
  };
  stepSecondsLeft: number | null;
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

export interface CatalogStatus {
  phase: CatalogPhase;
  message: string;
  titleCount: number;
  builtAt: string | null;
  error: string | null;
  download: CatalogDownloadProgress | null;
  setup?: CatalogSetupProgress | null;
  titlesReady?: boolean;
  creditsReady?: boolean;
  titlesUpdateAvailable: boolean;
  creditsFailed: boolean;
  catalogUsable: boolean;
  tmdbHydration?: TmdbHydrationProgress;
}
