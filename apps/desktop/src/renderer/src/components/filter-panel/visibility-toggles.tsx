import type { JSX } from "react";

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
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <label className="mt-1 flex items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          name="hideWatched"
          className="accent-accent"
          checked={hideWatched}
          onChange={(e) => onChange({ hideWatched: e.target.checked })}
        />
        Hide watched
      </label>
      <label className="mt-1 flex items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          name="hideWatchlist"
          className="accent-accent"
          checked={hideWatchlist}
          onChange={(e) => onChange({ hideWatchlist: e.target.checked })}
        />
        Hide watchlist
      </label>
    </div>
  );
}
