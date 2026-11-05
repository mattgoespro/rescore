import { useId, useState, type JSX, type Ref } from "react";
import type { AppView, CatalogStatus } from "../../../shared/types";
import mark from "../assets/rescore-mark.png";
import { CATALOG_INDICATOR_COLOR, catalogIndicator } from "../lib/catalog-busy";
import { cn } from "../lib/cn";
import { iconBtn } from "../lib/ui";
import QueryField from "./filter-panel/query-field";
import { IconSettings } from "./icons";

const NAV: ReadonlyArray<{ id: AppView; label: string; shortcut: string }> = [
  { id: "discover", label: "Discover", shortcut: "Control+1" },
  { id: "foryou", label: "For you", shortcut: "Control+2" },
  { id: "library", label: "Library", shortcut: "Control+3" },
];

/**
 * The single 48px title bar: brand mark, primary navigation, search,
 * catalogue status (which opens the service log) and Settings. It is the
 * window drag region and leaves room on the right for the native caption
 * buttons drawn by titleBarOverlay.
 */
export default function TopBar({
  view,
  onNavigate,
  query,
  onQueryChange,
  queryRef,
  catalogStatus,
  onOpenLog,
}: {
  view: AppView;
  onNavigate: (view: AppView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  queryRef?: Ref<HTMLInputElement>;
  catalogStatus: CatalogStatus | null;
  onOpenLog: () => void;
}): JSX.Element {
  const tipId = useId();
  const status = catalogIndicator(catalogStatus);
  // The log hands focus back to the status when it closes; that alone should
  // not reopen the tooltip. Focusing it again later does.
  const [focusTipOff, setFocusTipOff] = useState(false);
  return (
    <header className="flex h-12 items-center gap-4 border-b border-line bg-canvas pl-4 app-drag">
      <img
        src={mark}
        alt="Rescore"
        width={24}
        height={24}
        className="size-6 shrink-0 select-none"
        draggable={false}
      />
      <nav
        aria-label="Primary"
        className="flex shrink-0 gap-0.75 rounded-app bg-wash-6 p-0.75 app-no-drag"
      >
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? "page" : undefined}
            aria-keyshortcuts={item.shortcut}
            className={cn(
              "h-7 rounded-control border-0 px-3 text-ui transition-colors duration-140",
              view === item.id
                ? "bg-lifted font-semibold text-accent-text"
                : "bg-transparent font-medium text-muted hover:bg-wash-6 hover:text-ink",
            )}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <QueryField
          value={query}
          onChange={onQueryChange}
          inputRef={queryRef}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 app-no-drag">
        <div className="group relative">
          {/* The status opens the catalogue service log. */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-describedby={tipId}
            className="flex h-8 items-center gap-2 rounded-control bg-wash-6 px-2.5 text-xs font-medium text-muted transition-colors duration-140 hover:bg-wash-8 hover:text-ink"
            onClick={() => {
              setFocusTipOff(true);
              onOpenLog();
            }}
            onBlur={() => {
              if (!document.querySelector("dialog:modal"))
                setFocusTipOff(false);
            }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-pip",
                CATALOG_INDICATOR_COLOR[status.state],
              )}
            />
            {status.label}
          </button>
          <div
            id={tipId}
            role="tooltip"
            className={cn(
              "invisible absolute top-10 right-0 z-50 flex w-60 flex-col gap-1 rounded-control border border-line bg-raised px-3 py-2.5 text-left group-hover:visible",
              !focusTipOff && "group-focus-within:visible",
            )}
          >
            <span className="text-ui font-semibold text-ink">{status.tip}</span>
            <span className="text-xs leading-copy text-muted">
              {status.detail}
            </span>
            <span className="text-xs leading-copy text-faint">
              Select to view the service log.
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-current={view === "settings" ? "page" : undefined}
          className={cn(
            iconBtn("bare"),
            "size-8",
            view === "settings" && "bg-selected text-accent-text",
          )}
          onClick={() => onNavigate("settings")}
        >
          <IconSettings />
        </button>
      </div>
      {/* Native minimise / maximise / close buttons sit over this space. */}
      <div aria-hidden="true" className="h-full w-[138px] shrink-0" />
    </header>
  );
}
