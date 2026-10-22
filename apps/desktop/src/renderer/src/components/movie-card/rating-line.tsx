import type { JSX } from "react";
import { formatVotes } from "../../../../shared/types";
import { cn } from "../../lib/cn";
import { IconStar } from "../icons";
import AgeCaption from "./age-caption";

export default function RatingLine({
  compact,
  voteAverage,
  voteCount,
  certification,
}: {
  compact?: boolean;
  voteAverage: number;
  voteCount: number;
  certification?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-1 tabular",
        compact ? "text-xs leading-caption" : "text-[13px] leading-copy",
      )}
    >
      <IconStar
        className={cn("text-accent", compact ? "size-3" : "size-3.5")}
      />
      <span className="font-semibold">{voteAverage.toFixed(1)}</span>
      <span className="text-faint">({formatVotes(voteCount)})</span>
      <AgeCaption rating={certification} className="ml-auto" />
    </div>
  );
}
