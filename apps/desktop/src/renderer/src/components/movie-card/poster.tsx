import type { JSX } from "react";
import { cn } from "../../lib/cn";

export default function Poster({
  src,
  grid,
  active,
}: {
  src: string | null;
  grid: boolean;
  active?: boolean;
}): JSX.Element {
  return (
    <div
      className={
        grid
          ? cn(
              "poster-ph relative aspect-2/3 h-auto w-full shrink-0 overflow-hidden rounded-lg",
              active && "shadow-[0_0_0_2px_var(--color-accent)]",
            )
          : "poster-ph relative h-16.5 w-11 shrink-0 overflow-hidden rounded-md"
      }
    >
      {src ? (
        <img
          className="block size-full object-cover"
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.remove();
          }}
        />
      ) : null}
    </div>
  );
}
