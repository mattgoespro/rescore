export interface CatalogBuildResult {
  titleCount: number;
  builtAt: string;
  revision: string;
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
}

export interface Credit {
  nconst: string;
  ordering: number;
}

export const MAX_DIRECTORS = 4;
export const MAX_CAST = 8;
export const TITLE_BATCH = 2_000;
export const PERSON_BATCH = 5_000;
export const STAGING_BATCH = 5_000;
