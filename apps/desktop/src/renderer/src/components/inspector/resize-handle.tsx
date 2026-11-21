import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { cn } from "../../lib/cn";

const WIDTH_KEY = "rescore.inspector.width";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const KEY_STEP = 24;

/** The widest the panel may be: half the window, as the CSS caps it. */
function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth / 2));
}

function clampWidth(width: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));
}

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH
      ? stored
      : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    /* A width that is not remembered is only a convenience lost. */
  }
}

/**
 * The docked panel's width, remembered across views and launches. The style
 * feeds `--inspector-w`, which the frame reads from the inspect breakpoint.
 */
export function useInspectorWidth(): {
  width: number;
  setWidth: (width: number, save: boolean) => void;
  style: CSSProperties;
} {
  const [width, setState] = useState(readWidth);
  return {
    width,
    setWidth: (next, save) => {
      const clamped = clampWidth(next);
      setState(clamped);
      if (save) saveWidth(clamped);
    },
    style: { "--inspector-w": `${width}px` } as CSSProperties,
  };
}

/**
 * Drags the panel's left edge. Arrow keys step it, Home restores the default
 * and a double-click does the same.
 */
export default function ResizeHandle({
  width,
  setWidth,
}: {
  width: number;
  setWidth: (width: number, save: boolean) => void;
}): JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Start from the rendered width, so a width the window caps moves at once.
    const rendered =
      event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
    drag.current = { startX: event.clientX, startWidth: rendered };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (!start) return;
    setWidth(start.startWidth - (event.clientX - start.startX), false);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    setDragging(false);
    setWidth(start.startWidth - (event.clientX - start.startX), true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next =
      event.key === "ArrowLeft"
        ? width + KEY_STEP
        : event.key === "ArrowRight"
          ? width - KEY_STEP
          : event.key === "Home"
            ? DEFAULT_WIDTH
            : null;
    if (next == null) return;
    event.preventDefault();
    setWidth(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize title details"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className={cn(
        "absolute inset-y-0 left-0 z-3 hidden w-1.5 cursor-col-resize touch-none transition-[background] duration-160 outline-none hover:bg-thumb focus-visible:bg-accent inspect:block",
        dragging && "bg-thumb-active",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => setWidth(DEFAULT_WIDTH, true)}
      onKeyDown={onKeyDown}
    />
  );
}
