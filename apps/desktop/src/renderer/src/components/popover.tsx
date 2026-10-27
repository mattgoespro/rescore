import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { placePopover, type PopoverPlacement } from "../lib/popover-position";

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A dialog attached to the control that opened it, centred under that control
 * when the window has room. Escape, a click outside, or tabbing out closes it;
 * Escape also returns focus to the control.
 */
export default function Popover({
  getAnchor,
  label,
  width,
  onClose,
  className,
  children,
}: {
  /** The control the popover hangs from; read after each render commits. */
  getAnchor: () => HTMLElement | null;
  label: string;
  width: number;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlacement | null>(null);

  const reposition = useCallback(() => {
    const anchor = getAnchor();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const next = placePopover({
      anchor: anchor.getBoundingClientRect(),
      width,
      height: panel.offsetHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPlace((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.width === next.width
        ? current
        : next,
    );
  }, [getAnchor, width]);

  // Each render can move the anchor without resizing it, as when the pill
  // row wraps; unchanged placements keep their state, so this settles.
  useLayoutEffect(reposition);

  const close = useCallback(
    (refocus: boolean) => {
      onClose();
      if (refocus) getAnchor()?.focus();
    },
    [getAnchor, onClose],
  );

  useLayoutEffect(() => {
    reposition();
    const panel = panelRef.current;
    const anchor = getAnchor();
    // The anchor resizes too: a pill grows when its summary changes.
    const observer = new ResizeObserver(reposition);
    if (panel) observer.observe(panel);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [getAnchor, reposition]);

  // Focus moves in once, after the first placement: a hidden panel cannot
  // take focus.
  const focused = useRef(false);
  useEffect(() => {
    if (!place || focused.current) return;
    focused.current = true;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
  }, [place]);

  useEffect(() => {
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || getAnchor()?.contains(target))
        return;
      close(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [getAnchor, close]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        "fixed z-40 rounded-control border border-control bg-raised p-4 outline-none",
        className,
      )}
      style={{
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        width: place?.width ?? width,
        visibility: place ? "visible" : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (
          next &&
          !panelRef.current?.contains(next) &&
          !getAnchor()?.contains(next)
        )
          close(false);
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
