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
        "block h-8 w-full rounded-[3px] border-0 px-2.5 text-left text-[13px] hover:bg-wash-6",
        selected
          ? "bg-selected font-semibold text-accent-text hover:bg-selected"
          : "bg-transparent text-ink",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
