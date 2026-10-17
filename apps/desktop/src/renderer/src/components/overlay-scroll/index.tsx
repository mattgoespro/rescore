import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type UIEvent,
} from "react";
import { cn } from "../../lib/cn";
import Thumb from "./thumb";

const OverlayScroll = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    children: ReactNode;
    id?: string;
    onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  }
>(function OverlayScroll(
  { className = "", children, id, onScroll },
  ref,
): JSX.Element {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 32, show: false });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    startY: number;
    startTop: number;
    height: number;
  } | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      viewRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const sync = useCallback(() => {
    const el = viewRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const overflow = scrollHeight > clientHeight + 1;
    const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = Math.max(0, clientHeight - height);
    const range = scrollHeight - clientHeight;
    const top = range <= 0 || maxTop <= 0 ? 0 : (scrollTop / range) * maxTop;
    const next = {
      top: Math.round(top),
      height: Math.round(height),
      show: overflow,
    };
    setThumb((prev) =>
      prev.top === next.top &&
      prev.height === next.height &&
      prev.show === next.show
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const mutations = new MutationObserver(sync);
    mutations.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [sync]);

  useEffect(() => {
    if (!dragging) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (event: PointerEvent): void => {
      const el = viewRef.current;
      const start = drag.current;
      if (!el || !start) return;
      const { scrollHeight, clientHeight } = el;
      const maxTop = Math.max(0, clientHeight - start.height);
      const nextTop = Math.min(
        maxTop,
        Math.max(0, start.startTop + event.clientY - start.startY),
      );
      const range = scrollHeight - clientHeight;
      el.scrollTop = maxTop <= 0 || range <= 0 ? 0 : (nextTop / maxTop) * range;
    };
    const onUp = (): void => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  return (
    <div className="relative min-h-0 flex-1 [--rail-gutter:14px]">
      <div
        ref={setRefs}
        id={id}
        className={cn(
          "scrollbar-none h-full overflow-auto overscroll-contain",
          className,
        )}
        tabIndex={0}
        role="region"
        aria-label="Titles"
        onScroll={(event) => {
          sync();
          onScroll?.(event);
        }}
      >
        {children}
      </div>
      {thumb.show ? (
        <Thumb
          top={thumb.top}
          height={thumb.height}
          dragging={dragging}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            drag.current = {
              startY: event.clientY,
              startTop: thumb.top,
              height: thumb.height,
            };
            setDragging(true);
          }}
        />
      ) : null}
    </div>
  );
});

export default OverlayScroll;
