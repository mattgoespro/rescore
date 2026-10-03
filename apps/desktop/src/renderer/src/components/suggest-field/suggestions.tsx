import type { JSX } from "react";
import { cn } from "../../lib/cn";

export default function Suggestions<
  T extends { id: string | number; name: string },
>({
  id,
  hits,
  active,
  onSelect,
}: {
  id: string;
  hits: T[];
  active: number;
  onSelect: (item: T) => void;
}): JSX.Element | null {
  if (!hits.length) return null;
  return (
    <div
      id={id}
      role="listbox"
      className="absolute top-[calc(100%+0.25rem)] right-0 left-0 z-6 overflow-hidden rounded-app border border-line bg-raised shadow-panel"
    >
      {hits.map((hit, index) => (
        <button
          key={hit.id}
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === active}
          className={cn(
            "block w-full border-0 bg-transparent px-2.5 py-2 text-left",
            index === active ? "bg-accent-soft" : "hover:bg-accent-soft",
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(hit)}
        >
          {hit.name}
        </button>
      ))}
    </div>
  );
}
