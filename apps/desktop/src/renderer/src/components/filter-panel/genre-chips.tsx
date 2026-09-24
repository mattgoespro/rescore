import type { JSX } from "react";
import type { Genre } from "../../../../shared/types";
import { chipClass } from "../../lib/ui";

export default function GenreChips({
  label = "Genres",
  hint,
  genres,
  selected,
  onToggle,
}: {
  label?: string;
  hint?: string;
  genres: Genre[];
  selected: number[];
  onToggle: (id: number) => void;
}): JSX.Element {
  return (
    <div className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      <p className="m-0 text-[11px] leading-[1.3] text-faint">
        {hint ??
          (selected.length
            ? "Match any selected genre."
            : "None selected — all genres included.")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {genres.map((genre) => (
          <button
            type="button"
            key={genre.id}
            className={chipClass(selected.includes(genre.id))}
            aria-pressed={selected.includes(genre.id)}
            onClick={() => onToggle(genre.id)}
          >
            {genre.name}
          </button>
        ))}
      </div>
    </div>
  );
}
