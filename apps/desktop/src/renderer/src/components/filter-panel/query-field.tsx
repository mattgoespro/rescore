import type { JSX, Ref } from "react";
import { cn } from "../../lib/cn";
import { searchIconClass, searchInputClass } from "../../lib/ui";
import { IconSearch } from "../icons";

/** Title and IMDb ID search, centred in the top bar on every view. */
export default function QueryField({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (query: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}): JSX.Element {
  return (
    <label className="relative flex h-8 w-full max-w-100 items-center app-no-drag">
      <span className="sr-only">Search titles or IMDb IDs</span>
      <IconSearch className={searchIconClass} />
      <input
        ref={inputRef}
        id="title-query"
        type="search"
        name="titleQuery"
        autoComplete="off"
        spellCheck={false}
        aria-keyshortcuts="Control+K"
        value={value}
        placeholder="Search titles or IMDb IDs…"
        className={cn(searchInputClass, "pr-16")}
        onChange={(event) => onChange(event.target.value)}
      />
      <kbd className="pointer-events-none absolute right-1.5 rounded-item border border-line px-1.5 py-px font-sans text-xs text-muted">
        Ctrl K
      </kbd>
    </label>
  );
}
