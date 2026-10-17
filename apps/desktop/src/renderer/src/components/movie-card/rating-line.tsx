import type { JSX } from "react";
import { formatVotes } from "../../../../shared/types";
import { cn } from "../../lib/cn";
import { IconStar } from "../icons";

export default function RatingLine({
  compact,
  voteAverage,
  voteCount,
}: {
  compact?: boolean;
  voteAverage: number;
  voteCount: number;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-1 tabular",
        compact
          ? "mt-0.5 text-[11px] leading-caption"
          : "mt-1 text-xs leading-copy",
      )}
    >
      <IconStar
        className={cn("text-accent", compact ? "size-3" : "size-3.5")}
      />
      <span className="font-650">{voteAverage.toFixed(1)}</span>
      <span className="text-muted">({formatVotes(voteCount)})</span>
    </div>
  );
}
