import type { JSX } from "react";
import type { MovieDetails } from "../../../../shared/types";

/**
 * The billed cast as names. IMDb's datasets carry no portraits or character
 * names, so photo cards would only ever show an initial.
 */
export default function CastList({
  cast,
}: {
  cast: NonNullable<MovieDetails["cast"]>;
}): JSX.Element | null {
  if (!cast.length) return null;
  return (
    <section className="mb-3 flex flex-col gap-1.5">
      <h3 className="kicker">Cast</h3>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {cast.slice(0, 8).map((person) => (
          <li
            key={person.id}
            className="rounded-full bg-wash-6 px-2.5 py-1 text-xs text-ink"
          >
            {person.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
