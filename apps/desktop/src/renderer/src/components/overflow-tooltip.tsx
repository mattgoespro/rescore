import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const SHOW_DELAY_MS = 350;
const MARGIN = 8;

/**
 * Single-line text that truncates with an ellipsis and, only when it is cut
 * off, shows the whole text in a tooltip on hover. The full text stays in
 * the element, so assistive technology reads it either way.
 */
export default function OverflowTooltip({
  as: Tag = "span",
  text,
  className,
  children,
}: {
  as?: ElementType;
  text: string;
  className?: string;
  children?: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const timer = useRef<number | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  function show(): void {
    const node = ref.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    timer.current = window.setTimeout(() => {
      const rect = node.getBoundingClientRect();
      setTip({ left: rect.left + rect.width / 2, top: rect.top });
    }, SHOW_DELAY_MS);
  }

  function hide(): void {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    setTip(null);
  }

  // Scrolling moves the text out from under a tooltip placed for it.
  useEffect(() => {
    if (!tip) return;
    const onScroll = (): void => setTip(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [tip]);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      <Tag
        ref={ref}
        className={cn("truncate", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children ?? text}
      </Tag>
      {tip
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed z-50 w-max max-w-80 animate-fade rounded-control border border-line bg-raised px-2.5 py-1.5 text-xs leading-copy font-medium text-ink"
              style={{
                left: Math.min(
                  Math.max(tip.left, 160 + MARGIN),
                  window.innerWidth - 160 - MARGIN,
                ),
                top: tip.top - 6,
                transform: "translate(-50%, -100%)",
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
