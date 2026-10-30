import type { JSX } from "react";
import type { CatalogSetupProgress } from "../../../../shared/catalog-status";
import { cn } from "../../lib/cn";
import {
  setupView,
  type SetupFileRow,
  type SetupStep,
} from "../../lib/setup-progress";
import { IconCheck } from "../icons";

function Bar({
  label,
  percent,
  className,
}: {
  label: string;
  percent: number;
  className: string;
}): JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("overflow-hidden rounded-full bg-wash-8", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StepMark({ state }: { state: SetupStep["state"] }): JSX.Element {
  if (state === "done")
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
        <IconCheck className="size-3" style={{ strokeWidth: 3 }} />
      </span>
    );
  if (state === "active")
    return (
      <span className="size-5 shrink-0 animate-catalog rounded-full border-2 border-accent/30 border-t-accent" />
    );
  return (
    <span className="size-5 shrink-0 rounded-full border-2 border-wash-9" />
  );
}

const STATE_TEXT: Record<SetupStep["state"], string> = {
  done: "done",
  active: "in progress",
  pending: "waiting",
};

function Rows({ rows }: { rows: SetupFileRow[] }): JSX.Element {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)_104px] items-center gap-x-3 gap-y-2 pl-8 text-xs text-muted">
      {rows.map((row) => (
        <div key={row.name} className="contents">
          <span className="truncate">{row.name}</span>
          <Bar label={row.name} percent={row.percent} className="h-1" />
          <span className="text-right tabular">{row.caption}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The first-launch and rebuild screen: overall progress through the title
 * steps that hold browsing, each step's own detail, and what follows them.
 */
export default function SetupScreen({
  setup,
  rebuilding,
}: {
  setup: CatalogSetupProgress;
  rebuilding: boolean;
}): JSX.Element {
  const view = setupView(setup, { rebuilding });
  return (
    <div className="absolute inset-0 z-3 flex overflow-auto bg-canvas p-8">
      <section
        aria-labelledby="setup-title"
        className="m-auto flex w-140 max-w-full flex-col gap-7 text-[13px] leading-copy"
      >
        <div className="flex flex-col gap-3">
          {view.firstLaunch ? (
            <p className="m-0 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
              First launch
            </p>
          ) : null}
          <div className="flex items-baseline justify-between gap-4">
            <h1
              id="setup-title"
              className="m-0 text-[22px] leading-compact font-650 text-ink"
            >
              {view.heading}
            </h1>
            <span
              aria-hidden="true"
              className="text-[32px] leading-none font-bold text-accent-text tabular"
            >
              {view.percent}%
            </span>
          </div>
          <Bar label="Catalogue setup" percent={view.percent} className="h-2" />
          <div className="flex justify-between gap-4 text-muted tabular">
            <span role="status" aria-live="polite">
              {view.stepLine}
            </span>
            {view.timeLeft ? <span>{view.timeLeft}</span> : null}
          </div>
        </div>

        <ol
          aria-label="Setup steps"
          className="m-0 flex list-none flex-col rounded-app bg-rail p-0"
        >
          {view.steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex flex-col gap-3 border-b border-wash-6 px-4 py-3.5 last:border-b-0",
                step.state === "active" && "bg-wash-3",
              )}
            >
              <div className="flex items-center gap-3">
                <StepMark state={step.state} />
                <span
                  className={cn(
                    "flex-1",
                    step.state === "active" && "font-semibold text-ink",
                    step.state === "done" && "text-ink",
                    step.state === "pending" && "text-faint",
                  )}
                >
                  {step.label}
                  <span className="sr-only">, {STATE_TEXT[step.state]}</span>
                </span>
                <span
                  className={cn(
                    "tabular",
                    step.state === "active" ? "text-muted" : "text-faint",
                  )}
                >
                  {step.detail}
                </span>
              </div>
              {step.rows.length ? <Rows rows={step.rows} /> : null}
            </li>
          ))}
        </ol>

        <p className="m-0 leading-description text-faint">
          Browsing opens when these two steps finish. Cast, directors, posters
          and synopses keep filling in afterwards. Your ratings, watchlist and
          skips are kept.
        </p>
      </section>
    </div>
  );
}
