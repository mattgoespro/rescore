import type { CatalogSetupProgress } from "../types.js";

export interface CatalogBuildResult {
  titleCount: number;
  builtAt: string;
  revision: string;
  unchanged?: boolean;
}

export interface CatalogBuildProgress {
  message: string;
  download?: {
    file: string;
    fileIndex: number;
    fileCount: number;
    receivedBytes: number;
    totalBytes: number | null;
  };
}

export interface CatalogBuildOptions {
  force?: boolean;
  onProgress?: (progress: CatalogBuildProgress) => void;
  /** Title steps' progress while they run, then null once they end. */
  onSetup?: (setup: CatalogSetupProgress | null) => void;
}

/** How title indexing reports what it has read and kept. */
export interface TitleIngestProgress {
  onRead?: (readBytes: number, totalBytes: number, imported: number) => void;
  /** Every row is read; the closing index rebuild starts next. */
  onScanned?: () => void;
}

export interface Credit {
  nconst: string;
  ordering: number;
}

export const MAX_DIRECTORS = 4;
export const MAX_CAST = 8;
export const TITLE_BATCH = 500;
