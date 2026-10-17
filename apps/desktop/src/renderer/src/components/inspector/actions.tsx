import type { JSX } from "react";
import type {
  LibraryEntry,
  MovieSummary,
  WatchStatus,
} from "../../../../shared/types";
import type { MediaType } from "../../../../shared/types";
import { btn } from "../../lib/ui";

export default function Actions({
  movie,
  entry,
  imdb,
  busy = false,
  onUpsert,
  onRemove,
}: {
  movie: MovieSummary;
  entry?: LibraryEntry;
  imdb: string | null;
  busy?: boolean;
  onUpsert: (
    movie: MovieSummary,
    status: WatchStatus,
    rating?: number,
  ) => Promise<void>;
  onRemove: (imdbId: string, mediaType: MediaType) => Promise<void>;
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <button
        className={btn("primary")}
        type="button"
        disabled={busy}
        aria-pressed={entry?.status === "watched"}
        onClick={() => onUpsert(movie, "watched", entry?.rating)}
      >
        Watched
      </button>
      <button
        className={btn()}
        type="button"
        disabled={busy}
        aria-pressed={entry?.status === "watchlist"}
        onClick={() => onUpsert(movie, "watchlist")}
      >
        Watchlist
      </button>
      <button
        className={btn()}
        type="button"
        disabled={busy}
        aria-pressed={entry?.status === "skipped"}
        onClick={() => onUpsert(movie, "skipped")}
      >
        Not for me
      </button>
      {entry ? (
        <button
          className={btn("danger")}
          type="button"
          disabled={busy}
          onClick={() => onRemove(movie.imdbId, movie.mediaType ?? "movie")}
        >
          Remove
        </button>
      ) : null}
      {imdb ? (
        <a className={btn("link")} href={imdb} target="_blank" rel="noreferrer">
          Open on IMDb
        </a>
      ) : null}
    </div>
  );
}
