import { cn } from "../../lib/cn";

/**
 * The panel's frame: beside the results from the inspect breakpoint, below
 * them on narrower windows. Docked, it is `--inspector-w` wide, at most half
 * the window. With `overlay`, an OverlayScroll inside does the
 * scrolling, so the frame itself must not.
 */
export function inspectorClass(overlay = false): string {
  return cn(
    "relative max-h-[34vh] min-h-0 border-t border-line bg-transparent p-0 inspect:max-h-none inspect:w-[min(var(--inspector-w),50vw)] inspect:border-t-0 inspect:border-l",
    overlay ? "overflow-hidden" : "overflow-auto overscroll-contain",
  );
}
