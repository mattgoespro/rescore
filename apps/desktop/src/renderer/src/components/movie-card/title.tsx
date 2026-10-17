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
        "mt-0 mb-1 font-650 tracking-tightish wrap-anywhere",
        grid ? "line-clamp-2 text-[15px]" : "text-[15px] leading-tight",
      )}
    >
      {title}
    </h2>
  );
}
