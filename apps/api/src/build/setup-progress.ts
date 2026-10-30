import type { CatalogSetupFile, CatalogSetupProgress } from "../types.js";

/**
 * Shares of the title steps, from a first launch on a typical connection:
 * the download takes about a tenth of the wait, indexing title.basics most
 * of it, and the closing index rebuild the rest.
 */
const DOWNLOAD_SHARE = 0.12;
const INDEX_SHARE = 1 - DOWNLOAD_SHARE;
const RATINGS_SHARE = 0.03;
const TITLES_SHARE = 0.87;
const FINISHING_AT = RATINGS_SHARE + TITLES_SHARE;

/** Estimates wait until a step has run this long and this far. */
const MIN_ESTIMATE_MS = 4000;
const MIN_ESTIMATE_FRACTION = 0.02;

type Stage = CatalogSetupProgress["index"]["stage"];

/** Collects the title steps' progress into one snapshot for status reports. */
export class SetupTracker {
  private readonly files = new Map<string, CatalogSetupFile>();
  private downloadStartedAt: number | null = null;
  private stage: Stage = "pending";
  private stageFraction = 0;
  private indexStartedAt: number | null = null;
  private titles = 0;

  constructor(
    fileNames: string[],
    private readonly now: () => number = Date.now,
  ) {
    for (const file of fileNames)
      this.files.set(file, {
        file,
        receivedBytes: 0,
        totalBytes: null,
        done: false,
      });
  }

  fileProgress(
    file: string,
    receivedBytes: number,
    totalBytes: number | null,
  ): void {
    this.downloadStartedAt ??= this.now();
    const entry = this.files.get(file);
    if (!entry || entry.done) return;
    entry.receivedBytes = receivedBytes;
    entry.totalBytes = totalBytes;
  }

  /** A file finished downloading, or was already on disk at this size. */
  fileDone(file: string, size: number): void {
    const entry = this.files.get(file);
    if (!entry) return;
    entry.receivedBytes = size;
    entry.totalBytes = size;
    entry.done = true;
  }

  indexStage(stage: Exclude<Stage, "pending">): void {
    if (this.stage === "pending") this.indexStartedAt = this.now();
    this.stage = stage;
    this.stageFraction = 0;
  }

  /** Compressed bytes read of the file the current stage scans. */
  indexBytes(readBytes: number, totalBytes: number): void {
    if (totalBytes > 0)
      this.stageFraction = Math.min(1, Math.max(0, readBytes / totalBytes));
  }

  indexTitles(count: number): void {
    this.titles = count;
  }

  snapshot(): CatalogSetupProgress {
    const files = [...this.files.values()].map((file) => ({ ...file }));
    const downloadFraction = this.downloadFraction(files);
    const indexFraction = this.indexFraction();
    const step = this.stage === "pending" ? "download" : "index";
    return {
      step,
      fraction: Math.min(
        1,
        DOWNLOAD_SHARE * (step === "index" ? 1 : downloadFraction) +
          INDEX_SHARE * indexFraction,
      ),
      files,
      bytesPerSecond: this.bytesPerSecond(files),
      index: {
        stage: this.stage,
        fraction: indexFraction,
        titles: this.titles,
      },
      stepSecondsLeft:
        step === "download"
          ? this.downloadSecondsLeft(files)
          : this.indexSecondsLeft(indexFraction),
    };
  }

  private downloadFraction(files: CatalogSetupFile[]): number {
    const total = files.reduce((sum, file) => sum + (file.totalBytes ?? 0), 0);
    if (files.some((file) => !file.done && file.totalBytes == null) || !total)
      return files.filter((file) => file.done).length / (files.length || 1);
    const received = files.reduce((sum, file) => sum + file.receivedBytes, 0);
    return Math.min(1, received / total);
  }

  private indexFraction(): number {
    switch (this.stage) {
      case "pending":
        return 0;
      case "ratings":
        return RATINGS_SHARE * this.stageFraction;
      case "titles":
        return RATINGS_SHARE + TITLES_SHARE * this.stageFraction;
      case "finishing":
        return FINISHING_AT;
      case "done":
        return 1;
    }
  }

  private bytesPerSecond(files: CatalogSetupFile[]): number | null {
    if (this.downloadStartedAt == null) return null;
    const elapsed = (this.now() - this.downloadStartedAt) / 1000;
    if (elapsed < 1 || files.every((file) => file.done)) return null;
    const received = files.reduce((sum, file) => sum + file.receivedBytes, 0);
    return received / elapsed;
  }

  private downloadSecondsLeft(files: CatalogSetupFile[]): number | null {
    const speed = this.bytesPerSecond(files);
    if (!speed || files.some((file) => file.totalBytes == null)) return null;
    const left = files.reduce(
      (sum, file) => sum + (file.totalBytes ?? 0) - file.receivedBytes,
      0,
    );
    return Math.max(0, Math.ceil(left / speed));
  }

  private indexSecondsLeft(fraction: number): number | null {
    if (this.indexStartedAt == null || this.stage === "finishing") return null;
    const elapsed = this.now() - this.indexStartedAt;
    if (elapsed < MIN_ESTIMATE_MS || fraction < MIN_ESTIMATE_FRACTION)
      return null;
    // The closing rebuild has no progress of its own, so it counts as left.
    return Math.ceil(((elapsed / fraction) * (1 - fraction)) / 1000);
  }
}

export interface SetupReport {
  tracker: SetupTracker;
  /** Sends a snapshot, at most every interval unless forced. */
  report(force?: boolean): void;
}

export function setupReport(
  fileNames: string[],
  onSetup: ((setup: CatalogSetupProgress) => void) | undefined,
  now: () => number = Date.now,
  intervalMs = 250,
): SetupReport {
  const tracker = new SetupTracker(fileNames, now);
  let last = -Infinity;
  return {
    tracker,
    report(force = false) {
      if (!onSetup) return;
      const at = now();
      if (!force && at - last < intervalMs) return;
      last = at;
      onSetup(tracker.snapshot());
    },
  };
}
