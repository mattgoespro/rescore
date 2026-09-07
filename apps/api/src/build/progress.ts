import type { CatalogBuildProgress } from "./types.js";

let progressSink: ((progress: CatalogBuildProgress) => void) | undefined;

export function setProgressSink(
  sink: ((progress: CatalogBuildProgress) => void) | undefined,
): void {
  progressSink = sink;
}

export function log(message: string): void {
  console.log(`[catalog] ${message}`);
  progressSink?.({ message });
}

export function reportDownload(progress: CatalogBuildProgress): void {
  const bytes = progress.download;
  if (!bytes || bytes.receivedBytes === 0) {
    console.log(`[catalog] ${progress.message}`);
  } else if (bytes.totalBytes && bytes.receivedBytes >= bytes.totalBytes) {
    console.log(`[catalog] ${progress.message} complete`);
  }
  progressSink?.(progress);
}
