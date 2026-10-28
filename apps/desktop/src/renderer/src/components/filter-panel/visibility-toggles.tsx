import type { JSX } from "react";

/** Checkboxes drawn as filled switches; they keep their checkbox semantics. */
const switchInput =
  "relative h-4.5 w-8 shrink-0 cursor-pointer appearance-none rounded-full border border-transparent bg-wash-9 transition-colors duration-140 before:absolute before:top-[3px] before:left-[3px] before:size-2.5 before:rounded-full before:bg-faint before:transition-transform before:duration-140 checked:bg-accent/30 checked:before:translate-x-3.5 checked:before:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text";

export default function VisibilityToggles({
  hideWatched,
  hideWatchlist,
  onChange,
}: {
  hideWatched: boolean;
  hideWatchlist: boolean;
  onChange: (partial: {
    hideWatched?: boolean;
    hideWatchlist?: boolean;
  }) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <label className="flex h-8 cursor-pointer items-center justify-between gap-3 text-sm text-ink">
        Hide watched
        <input
          type="checkbox"
          name="hideWatched"
          className={switchInput}
          checked={hideWatched}
          onChange={(e) => onChange({ hideWatched: e.target.checked })}
        />
      </label>
      <label className="flex h-8 cursor-pointer items-center justify-between gap-3 text-sm text-ink">
        Hide watchlist
        <input
          type="checkbox"
          name="hideWatchlist"
          className={switchInput}
          checked={hideWatchlist}
          onChange={(e) => onChange({ hideWatchlist: e.target.checked })}
        />
      </label>
    </div>
  );
}
