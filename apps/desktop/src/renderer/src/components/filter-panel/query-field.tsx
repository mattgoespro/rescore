import type { JSX, Ref } from "react";
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
      <IconSearch className="pointer-events-none absolute left-3 size-4 text-muted" />
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
        className="h-8 w-full min-w-0 rounded-control border border-transparent bg-wash-6 pr-16 pl-9 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => onChange(event.target.value)}
      />
      <kbd className="pointer-events-none absolute right-1.5 rounded-[3px] border border-line px-1.5 py-px font-sans text-xs text-muted">
        Ctrl K
      </kbd>
    </label>
  );
}
