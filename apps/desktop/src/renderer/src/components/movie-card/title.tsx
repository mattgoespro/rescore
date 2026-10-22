import type { JSX } from "react";
import { cn } from "../../lib/cn";

export default function Title({
  title,
  grid,
}: {
  title: string;
  grid: boolean;
}): JSX.Element {
  return (
    <h2
      className={cn(
        "m-0 text-sm leading-snug font-semibold wrap-anywhere",
        grid && "line-clamp-2",
      )}
    >
      {title}
    </h2>
  );
}
