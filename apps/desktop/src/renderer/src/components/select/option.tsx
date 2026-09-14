import type { JSX } from "react";
import { cn } from "../../lib/cn";

export default function Option({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className={cn(
        "block w-full rounded-lg border-0 px-2.5 py-2 text-left text-[13px] hover:bg-accent-soft hover:text-accent-2",
        selected
          ? "bg-accent-soft font-semibold text-accent-2"
          : "bg-transparent text-ink",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
