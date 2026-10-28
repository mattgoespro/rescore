import type { JSX } from "react";
import type { Genre } from "../../../../shared/types";
import { cn } from "../../lib/cn";
import { IconCheck } from "../icons";

type GenreState = "include" | "exclude" | "any";

/**
 * One tri-state chip per genre: click to include, again to exclude, again to
 * clear. Each chip is as wide as its label and the chips wrap as a row.
 */
export default function GenreChips({
  genres,
  included,
  excluded,
  onCycle,
}: {
  genres: Genre[];
  included: number[];
  excluded: number[];
  onCycle: (id: number, state: GenreState) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {genres.map((genre) => {
        const state: GenreState = included.includes(genre.id)
          ? "include"
          : excluded.includes(genre.id)
            ? "exclude"
            : "any";
        return (
          <button
            type="button"
            key={genre.id}
            aria-pressed={
              state === "any" ? false : state === "include" ? true : "mixed"
            }
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-140",
              state === "include" &&
                "bg-accent font-semibold text-accent-ink hover:bg-accent/90",
              state === "exclude" &&
                "bg-danger/15 text-danger line-through hover:bg-danger/20",
              state === "any" && "bg-wash-6 text-ink hover:bg-wash-9",
            )}
            onClick={() => onCycle(genre.id, state)}
          >
            {state === "include" ? (
              <IconCheck className="size-3.5 shrink-0" />
            ) : state === "exclude" ? (
              <span aria-hidden="true" className="font-bold no-underline">
                −
              </span>
            ) : null}
            {genre.name}
            <span className="sr-only">
              {state === "include"
                ? ", included"
                : state === "exclude"
                  ? ", excluded"
                  : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
