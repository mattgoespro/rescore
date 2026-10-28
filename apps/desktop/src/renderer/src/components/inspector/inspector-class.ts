import { cn } from "../../lib/cn";

/**
 * The panel's frame. With `overlay`, an OverlayScroll inside does the
 * scrolling, so the frame itself must not.
 */
export function inspectorClass(docked?: boolean, overlay = false): string {
  return cn(
    "max-h-[34vh] min-h-0 border-t border-line bg-transparent p-0 inspect:max-h-none inspect:border-t-0 inspect:border-l",
    overlay ? "overflow-hidden" : "overflow-auto overscroll-contain",
    docked && "max-inspect:col-start-2 max-inspect:max-h-[34vh]",
  );
}
