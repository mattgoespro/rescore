import { useRef, type JSX, type KeyboardEvent } from "react";
import type {
  LibraryEntry,
  MovieSummary,
  WatchStatus,
} from "../../../../shared/types";
import type { MediaType } from "../../../../shared/types";
import { segmentedCell, segmentedGroup } from "../../lib/ui";

const STATUSES: ReadonlyArray<{ value: WatchStatus; label: string }> = [
  { value: "watched", label: "Watched" },
  { value: "watchlist", label: "Watchlist" },
  { value: "skipped", label: "Not for me" },
];

/**
 * Where the title sits in the library, as one radio group, plus removal.
 * Arrow keys move the choice, as in the rating scale above it.
 */
export default function Actions({
  movie,
  entry,
  busy = false,
  onUpsert,
  onRemove,
}: {
  movie: MovieSummary;
  entry?: LibraryEntry;
  busy?: boolean;
  onUpsert: (
    movie: MovieSummary,
    status: WatchStatus,
    rating?: number,
  ) => Promise<void>;
  onRemove: (imdbId: string, mediaType: MediaType) => Promise<void>;
}): JSX.Element {
  const group = useRef<HTMLDivElement>(null);
  const current = entry?.status;

  function choose(status: WatchStatus): void {
    if (status === current) return;
    void onUpsert(
      movie,
      status,
      status === "watched" ? entry?.rating : undefined,
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + STATUSES.length) % STATUSES.length;
    group.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    choose(STATUSES[next]!.value);
  }

  const focusIndex = Math.max(
    0,
    STATUSES.findIndex((status) => status.value === current),
  );

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div
        ref={group}
        role="radiogroup"
        aria-label="In your library"
        className={segmentedGroup("text")}
      >
        {STATUSES.map((status, index) => (
          <button
            key={status.value}
            type="button"
            role="radio"
            aria-checked={current === status.value}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={busy}
            className={segmentedCell(current === status.value, "text")}
            onClick={() => choose(status.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {status.label}
          </button>
        ))}
      </div>
      {entry ? (
        <button
          className="h-7 self-end rounded-control px-2 text-xs font-semibold text-danger transition-colors duration-140 hover:bg-danger/12 disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          disabled={busy}
          onClick={() => onRemove(movie.imdbId, movie.mediaType ?? "movie")}
        >
          Remove from library
        </button>
      ) : null}
    </div>
  );
}
