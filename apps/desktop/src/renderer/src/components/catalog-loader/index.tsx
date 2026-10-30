import type { JSX } from "react";
import type { TmdbHydrationProgress } from "../../../../shared/types";
import type { CatalogSetupProgress } from "../../../../shared/catalog-status";
import { setupPercent, setupView } from "../../lib/setup-progress";
import { progressBarClass, progressFillClass } from "../../lib/ui";
import LoadingOverlay from "../loading-overlay";

export default function CatalogLoader({
  label,
  detail,
  setup,
  hydration,
  layout = "page",
}: {
  label: string;
  detail?: string;
  /** Title steps' progress, as the setup screen shows it in full. */
  setup?: CatalogSetupProgress | null;
  hydration?: TmdbHydrationProgress | null;
  layout?: "page" | "inline";
}): JSX.Element {
  const percent = setup ? setupPercent(setup.fraction) : null;
  const caption = setup
    ? `${percent}% · ${setupView(setup, { rebuilding: true }).stepLine}`
    : null;
  const inline = layout === "inline";

  return (
    <LoadingOverlay busy loadingText={label} inline={inline}>
      {setup ? (
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
            aria-label="Catalogue rebuild progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? 0}
          >
            <div
              className={`${progressFillClass} transition-[width] duration-200`}
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          {caption ? (
            <p
              className={
                inline
                  ? "m-0 text-xs leading-copy text-muted tabular"
                  : "m-0 text-center text-xs leading-copy text-muted tabular"
              }
            >
              {caption}
            </p>
          ) : null}
        </div>
      ) : null}
      {hydration && !hydration.complete && hydration.total > 0 ? (
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
            aria-valuenow={hydration.percent}
          >
            <div
              className={`${progressFillClass} transition-[width] duration-200`}
              style={{ width: `${hydration.percent}%` }}
            />
          </div>
          <p
            className={
              inline
                ? "m-0 text-xs leading-copy text-muted tabular"
                : "m-0 text-center text-xs leading-copy text-muted tabular"
            }
          >
            {`${hydration.percent}% · ${hydration.processed.toLocaleString()} / ${hydration.total.toLocaleString()}`}
          </p>
        </div>
      ) : null}
      {detail ? (
        <p
          className={
            inline
              ? "m-0 max-w-160 text-xs leading-copy text-muted"
              : "m-0 max-w-160 text-center text-xs leading-copy text-muted"
          }
        >
          {detail}
        </p>
      ) : null}
    </LoadingOverlay>
  );
}
