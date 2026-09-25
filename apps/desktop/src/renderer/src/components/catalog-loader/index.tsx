import type { JSX } from "react";
import type {
  CatalogDownloadProgress,
  TmdbHydrationProgress,
} from "../../../../shared/types";
import {
  tmdbHydrationCaption,
  visibleTmdbHydration,
} from "../../lib/catalog-busy";
import { progressBarClass, progressFillClass } from "../../lib/ui";
import Spinner from "./spinner";

export default function CatalogLoader({
  label,
  detail,
  download,
  hydration,
  layout = "page",
}: {
  label: string;
  detail?: string;
  download?: CatalogDownloadProgress | null;
  hydration?: TmdbHydrationProgress | null;
  layout?: "page" | "inline";
}): JSX.Element {
  const hydrationView = visibleTmdbHydration(hydration);
  const percent = download ? overallPercent(download) : null;
  const caption = download ? downloadCaption(download) : null;
  const inline = layout === "inline";

  return (
    <div
      className={
        inline
          ? "flex w-full flex-col items-start gap-2 text-[13px] text-muted"
          : "flex flex-col items-center justify-center gap-3 px-4 py-12 text-[13px] text-muted"
      }
    >
      <Spinner />
      <p className={inline ? "m-0" : "m-0 text-center"}>{label}</p>
      {download ? (
        <div
          className={
            inline
              ? "flex w-full max-w-md flex-col items-stretch gap-1.5"
              : "flex w-72 max-w-full flex-col items-stretch gap-1.5"
          }
        >
          <div
            className={progressBarClass}
            role="progressbar"
            aria-label="Dataset download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent ?? 0)}
          >
            <div
              className={`${progressFillClass} transition-[width] duration-200`}
              style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
            />
          </div>
          {caption ? (
            <p
              className={
                inline
                  ? "m-0 text-xs leading-[1.45] text-muted tabular"
                  : "m-0 text-center text-xs leading-[1.45] text-muted tabular"
              }
            >
              {caption}
            </p>
          ) : null}
        </div>
      ) : null}
      {hydrationView ? (
        <div
          className={
            inline
              ? "flex w-full max-w-md flex-col items-stretch gap-1.5"
              : "flex w-72 max-w-full flex-col items-stretch gap-1.5"
          }
        >
          <div
            className={progressBarClass}
            role="progressbar"
            aria-label="TMDb hydration progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hydrationView.percent}
            aria-valuetext={tmdbHydrationCaption(hydrationView)}
          >
            <div
              className={`${progressFillClass} transition-[width] duration-200`}
              style={{ width: `${hydrationView.percent}%` }}
            />
          </div>
          <p
            className={
              inline
                ? "m-0 text-xs leading-[1.45] text-muted tabular"
                : "m-0 text-center text-xs leading-[1.45] text-muted tabular"
            }
            aria-live="polite"
          >
            {tmdbHydrationCaption(hydrationView)}
          </p>
        </div>
      ) : null}
      {detail ? (
        <p
          className={
            inline
              ? "m-0 max-w-160 text-xs leading-[1.45] text-muted"
              : "m-0 max-w-160 text-center text-xs leading-[1.45] text-muted"
          }
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function overallPercent(download: CatalogDownloadProgress): number {
  if (download.fileCount <= 0) return 0;
  const fileFraction =
    download.totalBytes && download.totalBytes > 0
      ? Math.min(1, download.receivedBytes / download.totalBytes)
      : 0;
  return ((download.fileIndex - 1 + fileFraction) / download.fileCount) * 100;
}

function downloadCaption(download: CatalogDownloadProgress): string {
  const received = formatBytes(download.receivedBytes);
  const percent = Math.round(overallPercent(download));
  if (download.totalBytes && download.totalBytes > 0) {
    return `${percent}% · ${received} of ${formatBytes(download.totalBytes)}`;
  }
  if (download.receivedBytes <= 0) return "Starting download…";
  return `${percent}% · ${received} downloaded`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
