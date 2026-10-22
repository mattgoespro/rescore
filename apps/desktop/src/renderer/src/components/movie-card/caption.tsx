import type { JSX } from "react";
export default function Caption({
  compact,
  kind,
  year,
  seasons,
  runtime,
}: {
  compact?: boolean;
  kind: string | null;
  year: number | null | undefined;
  seasons: string | null;
  runtime: string | null;
}): JSX.Element | null {
  const parts = [kind, year ?? "—", seasons, runtime].filter(Boolean);
  if (!parts.length) return null;

  return (
    <div
      className={
        compact
          ? "truncate text-xs leading-caption text-muted tabular"
          : "truncate text-[13px] leading-copy text-muted tabular"
      }
    >
      {parts.join(" · ")}
    </div>
  );
}
