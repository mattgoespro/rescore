import type { JSX } from "react";

export default function ValueChips<
  T extends { id: string | number; name: string },
>({
  values,
  onRemove,
}: {
  values: T[];
  onRemove: (id: string | number) => void;
}): JSX.Element | null {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          className="inline-flex h-7 items-center gap-0.5 rounded-control bg-selected pr-0.5 pl-2.5 text-[13px] text-ink"
          key={value.id}
        >
          {value.name}
          <button
            type="button"
            className="grid size-6 place-items-center rounded-[3px] border-0 bg-transparent text-muted hover:bg-wash-8 hover:text-ink"
            aria-label={`Remove ${value.name}`}
            onClick={() => onRemove(value.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
