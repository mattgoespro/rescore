import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

/** Measures variable-height rows and keeps keyboard focus mounted while scrolling. */
export default function VirtualList<T>({
  items,
  scrollRef,
  getKey,
  renderItem,
  grid = false,
  estimateSize = 100,
  label = "Titles",
}: {
  items: T[];
  scrollRef: RefObject<HTMLDivElement | null>;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  grid?: boolean;
  estimateSize?: number;
  label?: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const columns = grid ? Math.max(1, Math.floor((width + 14) / 164)) : 1;
  const count = Math.ceil(items.length / columns);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () =>
      grid ? Math.max(220, (width / columns - 14) * 1.5 + 100) : estimateSize,
    getItemKey: (index) => `${columns}:${getKey(items[index * columns])}`,
    overscan: 4,
    useFlushSync: false,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedRow !== null) {
        for (const index of [focusedRow - 1, focusedRow, focusedRow + 1]) {
          if (index >= 0 && index < count) indexes.push(index);
        }
      }
      return [...new Set(indexes)].sort((a, b) => a - b);
    },
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = (): void => setWidth(container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    virtualizer.measure();
    setFocusedRow(null);
  }, [columns, estimateSize, grid]);

  return (
    <div
      ref={containerRef}
      role="list"
      aria-label={label}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-virtual-index]",
        );
        if (row) setFocusedRow(Number(row.dataset.virtualIndex));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocusedRow(null);
      }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          data-virtual-index={row.index}
          className="absolute top-0 left-0 grid w-full min-w-0"
          style={{
            transform: `translateY(${row.start}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: grid ? 14 : 0,
            paddingRight: 14,
            paddingBottom: grid ? 18 : 0,
          }}
        >
          {items
            .slice(row.index * columns, (row.index + 1) * columns)
            .map((item, offset) => (
              <div
                key={getKey(item)}
                className="min-w-0"
                role="listitem"
                aria-posinset={row.index * columns + offset + 1}
                aria-setsize={items.length}
              >
                {renderItem(item, row.index * columns + offset)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
