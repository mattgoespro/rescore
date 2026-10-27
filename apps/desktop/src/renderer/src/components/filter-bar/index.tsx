import { useCallback, useRef, useState, type JSX } from "react";
import type { DiscoverFilters, Genre } from "../../../../shared/types";
import { cn } from "../../lib/cn";
import {
  activeFilterCount,
  addableFields,
  FILTER_FIELDS,
  fieldLabel,
  resetFilters,
  visibleFields,
  type FilterFieldId,
} from "../../lib/filter-fields";
import { IconChevronDown, IconClose, IconPlus } from "../icons";
import Popover from "../popover";
import FieldEditor from "./editors";

type Open = FilterFieldId | "add" | null;

const EDITOR_WIDTH: Record<FilterFieldId, number> = {
  genres: 440,
  released: 360,
  quality: 340,
  languages: 360,
  library: 300,
  runtime: 340,
  directors: 340,
  cast: 340,
};

/**
 * Discover's filters as one row of pills. Each pill reads as its current
 * setting and opens its editor in a popover; optional filters wait in
 * "Add filter" until someone adds or sets them.
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
  const [open, setOpen] = useState<Open>(null);
  const [added, setAdded] = useState<ReadonlySet<FilterFieldId>>(new Set());
  const anchors = useRef(new Map<string, HTMLElement>());
  const changed = activeFilterCount(filters);
  const pills = visibleFields(filters, added);
  const addable = addableFields(filters, added);

  function patch(partial: Partial<DiscoverFilters>): void {
    setFilters({ ...filters, ...partial, page: 1 });
  }

  const anchorFor = useCallback(
    (key: string) => () => anchors.current.get(key) ?? null,
    [],
  );
  const getOpenAnchor = useCallback(
    () => (open ? (anchors.current.get(open) ?? null) : null),
    [open],
  );
  const close = useCallback(() => setOpen(null), []);
  const register = (key: string) => (node: HTMLElement | null) => {
    if (node) anchors.current.set(key, node);
    else anchors.current.delete(key);
  };

  function remove(id: FilterFieldId): void {
    const field = FILTER_FIELDS.find((f) => f.id === id)!;
    setAdded((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (open === id) setOpen(null);
    patch(field.clear());
    // "Add filter" may only reappear once the removal renders.
    requestAnimationFrame(() => anchors.current.get("add")?.focus());
  }

  const openField = pills.find((field) => field.id === open);

  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2"
    >
      {pills.map((field) => {
        const isChanged = field.changed(filters);
        const isOpen = open === field.id;
        const label = fieldLabel(field, filters);
        const summary = field.summary(filters, genres);
        return (
          <span key={field.id} className="inline-flex items-center gap-0.5">
            <button
              ref={register(field.id)}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              aria-label={`${field.name}: ${label === field.name ? "" : `${label} `}${summary}`}
              title={`${label} ${summary}`}
              className={cn(
                "inline-flex h-8 max-w-80 items-center gap-1.5 rounded-control border px-3 text-[13px] whitespace-nowrap transition-colors duration-140",
                isChanged
                  ? "border-accent bg-selected text-accent-text"
                  : "border-control bg-transparent text-ink hover:bg-wash-6",
                isOpen && "outline-2 outline-offset-1 outline-accent-text",
              )}
              onClick={() => setOpen(isOpen ? null : field.id)}
            >
              <span className={isChanged ? "text-accent-text" : "text-muted"}>
                {label}
              </span>
              <span className="truncate font-medium">{summary}</span>
              <IconChevronDown className="size-3.5 shrink-0" />
            </button>
            {!field.pinned ? (
              <button
                type="button"
                aria-label={`Remove the ${field.name.toLowerCase()} filter`}
                className="grid size-8 place-items-center rounded-control border border-control bg-transparent text-muted transition-colors duration-140 hover:bg-wash-6 hover:text-ink"
                onClick={() => remove(field.id)}
              >
                <IconClose className="size-3.5" />
              </button>
            ) : null}
          </span>
        );
      })}
      {addable.length ? (
        <button
          ref={register("add")}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open === "add"}
          className="inline-flex h-8 items-center gap-1.5 rounded-control border border-dashed border-control bg-transparent px-3 text-[13px] text-muted transition-colors duration-140 hover:bg-wash-6 hover:text-ink"
          onClick={() => setOpen(open === "add" ? null : "add")}
        >
          <IconPlus className="size-3.5" />
          Add filter
        </button>
      ) : null}
      {changed > 0 ? (
        <button
          type="button"
          className="h-8 px-2 text-[13px] text-accent-text underline underline-offset-3 hover:text-ink"
          onClick={() => {
            setAdded(new Set());
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
              anchorFor(openField.id)()?.focus();
            }}
          />
        </Popover>
      ) : null}
      {open === "add" && addable.length ? (
        <Popover
          getAnchor={getOpenAnchor}
          label="Add a filter"
          width={260}
          onClose={close}
          className="p-1"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {addable.map((field) => (
              <li key={field.id}>
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between gap-3 rounded-[3px] border-0 bg-transparent px-3 text-left text-sm text-ink hover:bg-wash-6"
                  onClick={() => {
                    setAdded((current) => new Set(current).add(field.id));
                    setOpen(field.id);
                  }}
                >
                  {fieldLabel(field, filters) === field.name
                    ? field.name
                    : fieldLabel(field, filters)}
                  <span className="text-xs text-faint">{field.group}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </div>
  );
}
