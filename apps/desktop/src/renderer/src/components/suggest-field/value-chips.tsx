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
          className="inline-flex items-center gap-1.5 rounded-full bg-wash-6 py-1 pr-2 pl-2.5 text-xs"
          key={value.id}
        >
          {value.name}
          <button
            type="button"
            className="border-0 bg-transparent px-0.5 text-muted"
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
