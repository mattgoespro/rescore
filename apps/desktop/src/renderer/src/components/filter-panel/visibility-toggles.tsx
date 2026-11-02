import type { JSX } from "react";

/** Checkboxes drawn as filled switches; they keep their checkbox semantics. */
const switchInput =
  "relative h-4.5 w-8 shrink-0 cursor-pointer appearance-none rounded-full border border-transparent bg-wash-9 transition-colors duration-140 before:absolute before:top-0.75 before:left-0.75 before:size-2.5 before:rounded-full before:bg-faint before:transition-transform before:duration-140 checked:bg-accent/30 checked:before:translate-x-3.5 checked:before:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text";

export type VisibilityKey =
  "hideWatched" | "hideWatchlist" | "hideMissingPoster" | "hideMissingSynopsis";

export default function VisibilityToggles({
  toggles,
  onChange,
}: {
  toggles: Array<{ key: VisibilityKey; label: string; checked: boolean }>;
  onChange: (partial: Partial<Record<VisibilityKey, boolean>>) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      {toggles.map(({ key, label, checked }) => (
        <label
          key={key}
          className="flex h-8 cursor-pointer items-center justify-between gap-3 text-sm text-ink"
        >
          {label}
          <input
            type="checkbox"
            name={key}
            className={switchInput}
            checked={checked}
            onChange={(e) => onChange({ [key]: e.target.checked })}
          />
        </label>
      ))}
    </div>
  );
}
