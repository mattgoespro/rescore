import type { CatalogBuildProgress } from "./types.js";
import type { CatalogPhase } from "../log/format.js";
import { emit, emitDownload, type LineSink } from "../log/write.js";

let progressSink: ((progress: CatalogBuildProgress) => void) | undefined;

export function setProgressSink(
  sink: ((progress: CatalogBuildProgress) => void) | undefined,
): void {
  progressSink = sink;
}

export function log(
  message: string,
  phase: CatalogPhase,
  sink?: LineSink,
): void {
  emit({ channel: "catalog", phase, level: "info", message }, sink);
  progressSink?.({ message });
}

export function reportDownload(
  progress: CatalogBuildProgress,
  sink?: LineSink,
): void {
  const bytes = progress.download;
  const started = !bytes || bytes.receivedBytes === 0;
  const finished = Boolean(
    bytes?.totalBytes && bytes.receivedBytes >= bytes.totalBytes,
  );
  const message = finished ? `${progress.message} complete` : progress.message;
  const tty = sink?.isTTY ?? Boolean(process.stdout.isTTY);
  const fields = {
    channel: "catalog" as const,
    phase: "download" as const,
    level: "info" as const,
    message,
  };
  if (started || finished) emitDownload(fields, true, sink);
  else if (tty) emitDownload(fields, false, sink);
  progressSink?.(progress);
}
