import type { JSX } from "react";
import type { SearchHistoryEntry } from "../../../../shared/types";
import {
  historyGenresLabel,
  historyRatingLabel,
  historySortLabel,
  historyTitleKindLabel,
  historyYearsLabel,
} from "../../../../shared/search-history";
import { cn } from "../../lib/cn";

export default function HistoryOption({
  entry,
  active,
  onApply,
  onRemove,
}: {
  entry: SearchHistoryEntry;
  active: boolean;
  onApply: () => void;
  onRemove: () => void;
}): JSX.Element {
  const rows = [
    ...(entry.filters?.query ? [["Title", entry.filters.query]] : []),
    ["Title type", historyTitleKindLabel(entry.titleKind)],
    ["Genres", historyGenresLabel(entry.genres)],
    ["Years", historyYearsLabel(entry.yearMin, entry.yearMax)],
    ["Min rating", historyRatingLabel(entry.ratingMin)],
    ["Sort", historySortLabel(entry.sortBy)],
  ] as const;

  return (
    <div
      className={cn(
        "flex items-start gap-0.5 rounded-lg not-last:mb-0.5 not-last:border-b not-last:border-line not-last:pb-0.5",
        active ? "bg-accent-soft" : "bg-transparent hover:bg-wash-6",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left"
        onClick={onApply}
      >
        <dl className="m-0 flex flex-col gap-1">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-2.5"
            >
              <dt className="text-[11px] leading-detail font-medium whitespace-nowrap text-faint">
                {label}
              </dt>
              <dd
                className={cn(
                  "m-0 min-w-0 text-[12px] leading-detail wrap-break-word",
                  label === "Title type"
                    ? "font-semibold text-ink"
                    : "text-ink",
                  (label === "Years" || label === "Min rating") && "tabular",
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </button>
      <button
        type="button"
        className="mt-1 mr-1 grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-wash-8 hover:text-danger"
        aria-label="Remove from search history"
        title="Remove"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-3.5 fill-none stroke-current stroke-icon [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
