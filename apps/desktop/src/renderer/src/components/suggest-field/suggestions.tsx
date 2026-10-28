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
      className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-6 overflow-hidden rounded-control border border-line bg-raised p-1"
    >
      {hits.map((hit, index) => (
        <button
          key={hit.id}
          id={`${id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === active}
          className={cn(
            "block h-8 w-full rounded-[3px] border-0 bg-transparent px-2.5 text-left text-[13px] text-ink",
            index === active ? "bg-selected" : "hover:bg-wash-6",
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
