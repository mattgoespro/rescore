import type { JSX, PointerEvent } from "react";
import { cn } from "../../lib/cn";

export default function Thumb({
  top,
  height,
  dragging,
  onPointerDown,
}: {
  top: number;
  height: number;
  dragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-y-1.5 right-0.75 z-2 w-2 rounded-full bg-rail"
      aria-hidden="true"
    >
      <div
        className={cn(
          "pointer-events-auto absolute right-px w-1.5 cursor-ns-resize rounded-full bg-thumb opacity-100 transition-[background,width] duration-160",
          dragging && "w-2 bg-thumb-active",
        )}
        style={{ top, height }}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
