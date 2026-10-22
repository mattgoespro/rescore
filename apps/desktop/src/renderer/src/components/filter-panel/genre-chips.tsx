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
              "inline-flex h-8 items-center gap-1 rounded-control border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-140",
              state === "include" &&
                "border-accent bg-selected text-accent-text",
              state === "exclude" &&
                "border-danger bg-transparent text-danger line-through",
              state === "any" &&
                "border-control bg-transparent text-ink hover:bg-wash-6",
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
