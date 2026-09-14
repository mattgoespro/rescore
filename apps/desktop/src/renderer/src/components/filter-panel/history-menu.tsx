import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { SearchHistoryEntry } from "../../../../shared/types";
import { btn, overlayPanelClass } from "../../lib/ui";
import { cn } from "../../lib/cn";
import Chevron from "../select/chevron";
import HistoryOption from "./history-option";

const MENU_WIDTH = 320;

export default function HistoryMenu({
  entries,
  activeId,
  onApply,
  onRemove,
}: {
  entries: SearchHistoryEntry[];
  activeId: string | null;
  onApply: (entry: SearchHistoryEntry) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({
    top: 0,
    left: 0,
    width: MENU_WIDTH,
    maxHeight: 360,
  });

  function placeMenu(): void {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const maxHeight = Math.min(
      420,
      Math.max(160, Math.max(spaceBelow, spaceAbove)),
    );
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const width = Math.min(MENU_WIDTH, window.innerWidth - 24);
    setMenuPos({
      top: openUp ? rect.top - maxHeight - 4 : rect.bottom + 4,
      left: Math.max(
        12,
        Math.min(rect.right - width, window.innerWidth - width - 12),
      ),
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return;
    placeMenu();
    queueMicrotask(() => menuRef.current?.focus());
    const onDoc = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onReposition = (): void => placeMenu();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, entries.length]);

  function onButtonKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div>
      <button
        ref={buttonRef}
        className={cn(
          btn("ghost", "compact"),
          "inline-flex items-center gap-1 pr-2",
        )}
        type="button"
        aria-label="Search history"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onButtonKey}
      >
        History
        <Chevron className={cn("size-3.5", open && "rotate-180")} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={id}
              className={overlayPanelClass}
              role="menu"
              aria-label="Search history"
              tabIndex={-1}
              style={{
                top: menuPos.top,
                left: menuPos.left,
                width: menuPos.width,
                maxHeight: menuPos.maxHeight,
              }}
            >
              {entries.length ? (
                <>
                  <p className="kicker sticky top-0 z-1 bg-raised px-2.5 py-2">
                    Saved searches
                  </p>
                  {entries.map((entry) => (
                    <HistoryOption
                      key={entry.id}
                      entry={entry}
                      active={entry.id === activeId}
                      onApply={() => {
                        onApply(entry);
                        setOpen(false);
                        buttonRef.current?.focus();
                      }}
                      onRemove={() => onRemove(entry.id)}
                    />
                  ))}
                </>
              ) : (
                <p className="m-0 px-2.5 py-3 text-[12px] leading-[1.45] text-muted">
                  No saved searches yet. Scroll through results or open a couple
                  of titles to record the current filters.
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
