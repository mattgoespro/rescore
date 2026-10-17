import type { JSX } from "react";
import type { MovieDetails } from "../../../../shared/types";

export default function Directors({
  directors,
}: {
  directors: NonNullable<MovieDetails["directors"]>;
}): JSX.Element | null {
  if (!directors.length) return null;
  return (
    <p className="my-2 mb-3 text-xs leading-copy text-muted tabular">
      {directors.map((d) => d.name).join(", ")}
    </p>
  );
}
