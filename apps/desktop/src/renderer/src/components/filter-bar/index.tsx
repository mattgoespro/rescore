import { useCallback, useRef, useState, type JSX } from "react";
import type { DiscoverFilters, Genre } from "../../../../shared/types";
import { cn } from "../../lib/cn";
import {
  activeFilterCount,
  FILTER_FIELDS,
  fieldLabel,
  resetFilters,
  type FilterFieldId,
} from "../../lib/filter-fields";
import { IconChevronDown } from "../icons";
import Popover from "../popover";
import FieldEditor from "./editors";

/**
 * Excluded values pinned at the end of a pill: the one name, or a count once
 * there are several. It never shrinks, so a long lead truncates first.
 */
function ExclusionTail({
  excluded,
}: {
  excluded: string[];
}): JSX.Element | null {
  if (excluded.length === 1)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-danger">
        <span aria-hidden="true" className="text-faint">
          ·
        </span>
        not <span className="font-medium line-through">{excluded[0]}</span>
      </span>
    );
  if (excluded.length > 1)
    return (
      <span className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-danger/15 px-1.5 text-xs font-semibold text-danger">
        <span aria-hidden="true">−</span>
        {excluded.length}
      </span>
    );
  return null;
}

const EDITOR_WIDTH: Record<FilterFieldId, number> = {
  genres: 440,
  released: 360,
  quality: 340,
  runtime: 340,
  languages: 360,
  library: 300,
};

/**
 * Discover's filters as one row of pills. Each pill reads as its current
 * setting and opens its editor in a popover.
 */
export default function FilterBar({
  filters,
  setFilters,
  genres,
}: {
  filters: DiscoverFilters;
  setFilters: (filters: DiscoverFilters) => void;
  genres: Genre[];
}): JSX.Element {
  const [open, setOpen] = useState<FilterFieldId | null>(null);
  const anchors = useRef(new Map<FilterFieldId, HTMLElement>());
  const changed = activeFilterCount(filters);

  function patch(partial: Partial<DiscoverFilters>): void {
    setFilters({ ...filters, ...partial, page: 1 });
  }

  const getOpenAnchor = useCallback(
    () => (open ? (anchors.current.get(open) ?? null) : null),
    [open],
  );
  const close = useCallback(() => setOpen(null), []);
  const register = (id: FilterFieldId) => (node: HTMLElement | null) => {
    if (node) anchors.current.set(id, node);
    else anchors.current.delete(id);
  };

  const openField = FILTER_FIELDS.find((field) => field.id === open);

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2"
    >
      {FILTER_FIELDS.map((field) => {
        const isChanged = field.changed(filters);
        const isOpen = open === field.id;
        const label = fieldLabel(field, filters);
        const summary = field.summary(filters, genres);
        const tail = field.exclusionTail?.(filters, genres);
        return (
          <button
            key={field.id}
            ref={register(field.id)}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-label={`${field.name}: ${label === field.name ? "" : `${label} `}${summary}`}
            title={`${label} ${summary}`}
            className={cn(
              "inline-flex h-8 max-w-80 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors duration-140",
              isChanged
                ? "bg-accent/15 text-accent-text hover:bg-accent/20"
                : "bg-wash-6 text-ink hover:bg-wash-9",
              isOpen && "bg-lifted ring-2 ring-accent/55",
            )}
            onClick={() => setOpen(isOpen ? null : field.id)}
          >
            <span className={isChanged ? "text-accent-text" : "text-muted"}>
              {label}
            </span>
            {tail ? (
              <>
                <span className="min-w-0 truncate font-medium">
                  {tail.lead}
                </span>
                <ExclusionTail excluded={tail.excluded} />
              </>
            ) : (
              <span className="truncate font-medium">{summary}</span>
            )}
            <IconChevronDown className="size-3.5 shrink-0" />
          </button>
        );
      })}
      {changed > 0 ? (
        <button
          type="button"
          className="h-8 px-2 text-[13px] text-accent-text underline underline-offset-3 hover:text-ink"
          onClick={() => {
            setOpen(null);
            setFilters(resetFilters(filters));
          }}
        >
          Reset filters
        </button>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {changed === 0
          ? "Using the default filters"
          : `${changed} ${changed === 1 ? "filter" : "filters"} changed`}
      </span>

      {openField ? (
        <Popover
          key={openField.id}
          getAnchor={getOpenAnchor}
          label={openField.name}
          width={EDITOR_WIDTH[openField.id]}
          onClose={close}
        >
          <FieldEditor
            id={openField.id}
            filters={filters}
            patch={patch}
            genres={genres}
            onDone={() => {
              setOpen(null);
              anchors.current.get(openField.id)?.focus();
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}
