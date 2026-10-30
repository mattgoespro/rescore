import type { CatalogSetupProgress } from "../../../shared/catalog-status";

export type SetupStepState = "done" | "active" | "pending";

export interface SetupFileRow {
  name: string;
  percent: number;
  caption: string;
}

export interface SetupStep {
  id: "download" | "index";
  label: string;
  state: SetupStepState;
  detail: string;
  /** The active step's own bars: one per file, or one for indexing. */
  rows: SetupFileRow[];
}

export interface SetupView {
  heading: string;
  firstLaunch: boolean;
  percent: number;
  stepLine: string;
  timeLeft: string | null;
  steps: SetupStep[];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return "under a minute";
  return `${Math.ceil(seconds / 60)} min`;
}

/** The dump's dataset name, without its archive suffix. */
function datasetName(file: string): string {
  return file.replace(/\.tsv\.gz$/, "");
}

function percentOf(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((part / whole) * 100)));
}

/**
 * Whole percent for the bar, held below 100 until the API lifts the screen,
 * so it never reads as finished while it is still on screen.
 */
export function setupPercent(fraction: number): number {
  return Math.min(99, Math.max(0, Math.floor(fraction * 100)));
}

const INDEX_DETAIL: Record<CatalogSetupProgress["index"]["stage"], string> = {
  pending: "Waiting",
  ratings: "Reading ratings",
  titles: "Reading titles",
  finishing: "Finishing up",
  done: "Done",
};

export function setupView(
  setup: CatalogSetupProgress,
  options: { rebuilding: boolean; locale?: string },
): SetupView {
  const count = (value: number) => value.toLocaleString(options.locale);
  const downloading = setup.step === "download";
  const totalBytes = setup.files.reduce(
    (sum, file) => sum + (file.totalBytes ?? file.receivedBytes),
    0,
  );
  const receivedBytes = setup.files.reduce(
    (sum, file) => sum + file.receivedBytes,
    0,
  );
  const sizesKnown = setup.files.every((file) => file.totalBytes != null);

  const download: SetupStep = {
    id: "download",
    label: downloading ? "Downloading titles" : "Download titles",
    state: downloading ? "active" : "done",
    detail: downloading
      ? [
          sizesKnown
            ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
            : `${formatBytes(receivedBytes)} downloaded`,
          setup.bytesPerSecond ? formatSpeed(setup.bytesPerSecond) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : formatBytes(totalBytes),
    rows: downloading
      ? setup.files.map((file) => ({
          name: datasetName(file.file),
          percent: file.done
            ? 100
            : percentOf(file.receivedBytes, file.totalBytes),
          caption: file.done
            ? `${formatBytes(file.receivedBytes)} · done`
            : file.totalBytes
              ? `${formatBytes(file.receivedBytes)} / ${formatBytes(file.totalBytes)}`
              : formatBytes(file.receivedBytes),
        }))
      : [],
  };

  const stage = setup.index.stage;
  const indexing = !downloading;
  const index: SetupStep = {
    id: "index",
    label: indexing ? "Indexing titles" : "Index titles",
    state: indexing ? "active" : "pending",
    detail:
      stage === "titles" && setup.index.titles > 0
        ? `${count(setup.index.titles)} titles`
        : INDEX_DETAIL[stage],
    rows: indexing
      ? [
          {
            name: INDEX_DETAIL[stage],
            percent: Math.floor(setup.index.fraction * 100),
            caption: `${Math.floor(setup.index.fraction * 100)}%`,
          },
        ]
      : [],
  };

  const seconds = setup.stepSecondsLeft;
  return {
    heading: options.rebuilding
      ? "Rebuilding your catalogue"
      : "Setting up your catalogue",
    firstLaunch: !options.rebuilding,
    percent: setupPercent(setup.fraction),
    stepLine: `Step ${downloading ? 1 : 2} of 2 · ${downloading ? download.label : index.label}`,
    timeLeft:
      seconds == null
        ? null
        : downloading
          ? `Download done in ${formatWait(seconds)}`
          : `About ${formatWait(seconds)} left`,
    steps: [download, index],
  };
}
