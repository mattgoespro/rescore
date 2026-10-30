import type {
  CatalogSetupFile,
  CatalogSetupProgress,
  SetupTimings,
} from "../types.js";

export type { SetupTimings };

/**
 * The download's share of the bar when no earlier run has been measured, from
 * a first launch on a typical connection: indexing title.basics is most of
 * the wait.
 */
const DEFAULT_DOWNLOAD_SHARE = 0.12;
/** A measured share stays inside this range, so neither step vanishes. */
const MIN_DOWNLOAD_SHARE = 0.02;
const MAX_DOWNLOAD_SHARE = 0.6;
const RATINGS_SHARE = 0.03;
const TITLES_SHARE = 0.87;
const FINISHING_AT = RATINGS_SHARE + TITLES_SHARE;

/** Estimates wait until a step has run this long and this far. */
const MIN_ESTIMATE_MS = 4000;
const MIN_ESTIMATE_FRACTION = 0.02;
/** A download speed counts only from at least this much over this long. */
const MIN_MEASURED_BYTES = 5 * 1024 ** 2;
const MIN_MEASURED_MS = 1000;

type Stage = CatalogSetupProgress["index"]["stage"];

export const NO_SETUP_TIMINGS: SetupTimings = {
  downloadBytesPerSecond: null,
  downloadBytes: null,
  indexSeconds: null,
};

/** The download's share of the bar, from measured times when there are any. */
export function downloadShare(history: SetupTimings): number {
  const { downloadBytesPerSecond, downloadBytes, indexSeconds } = history;
  if (!downloadBytesPerSecond || !downloadBytes || !indexSeconds)
    return DEFAULT_DOWNLOAD_SHARE;
  const downloadSeconds = downloadBytes / downloadBytesPerSecond;
  const share = downloadSeconds / (downloadSeconds + indexSeconds);
  return Math.min(MAX_DOWNLOAD_SHARE, Math.max(MIN_DOWNLOAD_SHARE, share));
}

/** This run's measurements over the last ones, field by field. */
export function mergeSetupTimings(
  previous: SetupTimings,
  measured: SetupTimings,
): SetupTimings {
  return {
    downloadBytesPerSecond:
      measured.downloadBytesPerSecond ?? previous.downloadBytesPerSecond,
    downloadBytes: measured.downloadBytes ?? previous.downloadBytes,
    indexSeconds: measured.indexSeconds ?? previous.indexSeconds,
  };
}

interface TrackedFile extends CatalogSetupFile {
  /** Bytes came over the network, rather than from a dump already on disk. */
  fetched: boolean;
  doneAt: number | null;
}

/** Collects the title steps' progress into one snapshot for status reports. */
export class SetupTracker {
  private readonly files = new Map<string, TrackedFile>();
  private readonly downloadShare: number;
  private downloadStartedAt: number | null = null;
  private stage: Stage = "pending";
  private stageFraction = 0;
  private indexStartedAt: number | null = null;
  private indexDoneAt: number | null = null;
  private titles = 0;

  constructor(
    fileNames: string[],
    private readonly history: SetupTimings = NO_SETUP_TIMINGS,
    private readonly now: () => number = Date.now,
  ) {
    this.downloadShare = downloadShare(history);
    for (const file of fileNames)
      this.files.set(file, {
        file,
        receivedBytes: 0,
        totalBytes: null,
        done: false,
        fetched: false,
        doneAt: null,
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
    entry.fetched = true;
  }

  /** A file finished downloading, or was already on disk at this size. */
  fileDone(file: string, size: number): void {
    const entry = this.files.get(file);
    if (!entry) return;
    entry.receivedBytes = size;
    entry.totalBytes = size;
    entry.done = true;
    entry.doneAt = this.now();
  }

  indexStage(stage: Exclude<Stage, "pending">): void {
    if (this.stage === "pending") this.indexStartedAt = this.now();
    if (stage === "done") this.indexDoneAt = this.now();
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

  /**
   * What this run measured: the download speed when enough came over the
   * network, the dumps' size once both are known, and the index time when
   * indexing ran to the end.
   */
  timings(): SetupTimings {
    const files = [...this.files.values()];
    const fetched = files.filter((file) => file.fetched && file.doneAt != null);
    const fetchedBytes = fetched.reduce(
      (sum, file) => sum + file.receivedBytes,
      0,
    );
    const fetchedMs =
      this.downloadStartedAt == null || !fetched.length
        ? 0
        : Math.max(...fetched.map((file) => file.doneAt!)) -
          this.downloadStartedAt;
    return {
      downloadBytesPerSecond:
        fetchedBytes >= MIN_MEASURED_BYTES && fetchedMs >= MIN_MEASURED_MS
          ? fetchedBytes / (fetchedMs / 1000)
          : null,
      downloadBytes: files.every((file) => file.done)
        ? files.reduce((sum, file) => sum + file.receivedBytes, 0)
        : null,
      indexSeconds:
        this.indexStartedAt != null && this.indexDoneAt != null
          ? (this.indexDoneAt - this.indexStartedAt) / 1000
          : null,
    };
  }

  snapshot(): CatalogSetupProgress {
    const files = [...this.files.values()].map(
      ({ file, receivedBytes, totalBytes, done }) => ({
        file,
        receivedBytes,
        totalBytes,
        done,
      }),
    );
    const downloadFraction = this.downloadFraction(files);
    const indexFraction = this.indexFraction();
    const step = this.stage === "pending" ? "download" : "index";
    return {
      step,
      fraction: Math.min(
        1,
        this.downloadShare * (step === "index" ? 1 : downloadFraction) +
          (1 - this.downloadShare) * indexFraction,
      ),
      files,
      bytesPerSecond: this.bytesPerSecond(),
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

  /** Network speed so far, counting only bytes actually downloaded. */
  private bytesPerSecond(): number | null {
    if (this.downloadStartedAt == null) return null;
    const files = [...this.files.values()];
    const elapsed = (this.now() - this.downloadStartedAt) / 1000;
    if (elapsed < 1 || files.every((file) => file.done)) return null;
    const received = files
      .filter((file) => file.fetched)
      .reduce((sum, file) => sum + file.receivedBytes, 0);
    return received / elapsed;
  }

  private downloadSecondsLeft(files: CatalogSetupFile[]): number | null {
    const speed = this.bytesPerSecond();
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
    if (elapsed < MIN_ESTIMATE_MS || fraction < MIN_ESTIMATE_FRACTION) {
      // Too early to extrapolate: the last run's index time stands in.
      const last = this.history.indexSeconds;
      return last ? Math.ceil(last * (1 - fraction)) : null;
    }
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
  history: SetupTimings = NO_SETUP_TIMINGS,
  now: () => number = Date.now,
  intervalMs = 250,
): SetupReport {
  const tracker = new SetupTracker(fileNames, history, now);
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
