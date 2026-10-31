import type { JSX } from "react";
import type { MovieDetails } from "../../../../shared/types";

export default function Directors({
  directors,
}: {
  directors: NonNullable<MovieDetails["directors"]>;
}): JSX.Element | null {
  if (!directors.length) return null;
  return (
    <section className="mb-3 flex flex-col gap-1">
      <h3 className="kicker">
        {directors.length === 1 ? "Director" : "Directors"}
      </h3>
      <p className="m-0 text-ui leading-copy text-ink">
        {directors.map((d) => d.name).join(", ")}
      </p>
    </section>
  );
}
