export type CatalogPhase = "starting" | "building" | "ready" | "error";

export interface CatalogDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  receivedBytes: number;
  totalBytes: number | null;
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
}
