import type { JSX } from "react";
import AgeCaption from "./age-caption";

export default function Caption({
  compact,
  kind,
  year,
  seasons,
  runtime,
  certification,
}: {
  compact?: boolean;
  kind: string | null;
  year: number | null | undefined;
  seasons: string | null;
  runtime: string | null;
  certification?: string;
}): JSX.Element | null {
  const parts = [kind, year ?? "—", seasons, runtime].filter(Boolean);
  if (!parts.length) return null;

  return (
    <div
      className={
        compact
          ? "text-[11px] leading-caption text-muted tabular"
          : "text-xs leading-copy text-muted tabular"
      }
    >
      {parts.join(" · ")}
      <AgeCaption rating={certification} />
    </div>
  );
}
