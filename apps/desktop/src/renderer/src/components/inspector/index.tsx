import { useEffect, useRef, useState, type JSX } from "react";
import type {
  LibraryEntry,
  MovieDetails,
  MovieSummary,
  WatchStatus,
} from "../../../../shared/types";
import {
  formatRuntime,
  formatSeasons,
  imdbUrl,
  titleKindLabel,
  type MediaType,
} from "../../../../shared/types";
import Actions from "./actions";
import CastList from "./cast-list";
import Directors from "./directors";
import EmptyState from "./empty-state";
import Heading from "./heading";
import HeroPoster from "./hero-poster";
import { inspectorClass } from "./inspector-class";
import LibraryStatus from "./library-status";
import MetaCaption from "./meta-caption";
import RatingScale from "./rating-scale";
import Stats from "./stats";

export function readMediaHydrationError(
  value: object | null | undefined,
): string | null {
  if (!value || !("mediaError" in value)) return null;
  const message = (value as { mediaError?: unknown }).mediaError;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

export default function Inspector({
  movie,
  details,
  entry,
  match,
  genreMap,
  creditsReady,
  creditsFailed,
  docked,
  onUpsert,
  onRemove,
}: {
  movie: MovieSummary | null;
  details: MovieDetails | null;
  entry?: LibraryEntry;
  match?: number | null;
  genreMap: Map<number, string>;
  creditsReady?: boolean;
  creditsFailed?: boolean;
  docked?: boolean;
  onUpsert: (
    movie: MovieSummary,
    status: WatchStatus,
    rating?: number,
  ) => Promise<void>;
  onRemove: (imdbId: string, mediaType: MediaType) => Promise<void>;
}): JSX.Element {
  const [hydrated, setHydrated] = useState<MovieDetails | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const movieIdRef = useRef(movie?.imdbId ?? null);
  movieIdRef.current = movie?.imdbId ?? null;

  useEffect(() => {
    setHydrated(null);
    setRetryError(null);
    setRetrying(false);
  }, [movie?.imdbId]);

  async function retryHydration(): Promise<void> {
    if (!movie || retrying) return;
    const imdbId = movie.imdbId;
    setRetrying(true);
    try {
      const next = await window.api.movie(imdbId, movie.mediaType);
      if (movieIdRef.current !== imdbId) return;
      if (!next) {
        setRetryError("TMDb details could not be loaded. Try again.");
        return;
      }
      setHydrated(next);
      setRetryError(readMediaHydrationError(next));
    } catch (error) {
      if (movieIdRef.current !== imdbId) return;
      setRetryError(
        error instanceof Error
          ? error.message
          : "TMDb details could not be loaded. Try again.",
      );
    } finally {
      if (movieIdRef.current === imdbId) setRetrying(false);
    }
  }

  if (!movie) {
    return (
      <aside className={inspectorClass(docked)}>
        <EmptyState />
      </aside>
    );
  }

  const resolved = hydrated ?? details;
  const detailsMatch =
    resolved != null &&
    resolved.imdbId === movie.imdbId &&
    (resolved.mediaType ?? "movie") === (movie.mediaType ?? "movie");
  const hydrationError =
    retryError ?? (detailsMatch ? readMediaHydrationError(resolved) : null);
  const data = detailsMatch && resolved ? resolved : movie;
  const imdb = imdbUrl(resolved?.imdbId ?? movie.imdbId ?? entry?.imdbId);
  const genres = (
    resolved?.genres?.map((g) => g.name) ??
    data.genreIds.map((id) => genreMap.get(id)).filter(Boolean)
  )
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
  const runtime = formatRuntime(resolved?.runtime ?? movie.runtime);
  const seasons = formatSeasons(resolved?.seasonCount ?? movie.seasonCount);
  const matchValue =
    match ?? ("match" in movie ? (movie as { match?: number }).match : null);
  const subject = resolved ?? movie;

  return (
    <aside className={inspectorClass(docked)}>
      <div className="hero-ph relative aspect-[2/3] w-full overflow-hidden">
        <HeroPoster key={data.posterPath ?? "none"} path={data.posterPath} />
        <div className="hero-fade pointer-events-none absolute inset-x-0 bottom-0 h-[72px]" />
      </div>
      <div className="animate-fade px-4 pt-4 pb-[18px]" key={movie.imdbId}>
        <Heading
          title={data.title}
          rating={resolved?.certification ?? data.certification}
        />
        <MetaCaption
          parts={[
            titleKindLabel(data.titleKind),
            data.year,
            seasons,
            runtime,
            genres,
          ]}
        />
        {resolved?.tagline ? (
          <div className="mb-2.5 text-[13px] text-accent-2 italic">
            {resolved.tagline}
          </div>
        ) : null}
        <p className="mb-3.5 text-[13px] leading-[1.55] text-muted">
          {data.overview || "No synopsis available."}
        </p>
        {hydrationError ? (
          <p className="my-2 mb-3 text-xs leading-[1.45] text-muted">
            {hydrationError}{" "}
            <button
              type="button"
              className="text-ink underline decoration-line underline-offset-2 disabled:opacity-60"
              onClick={() => void retryHydration()}
              disabled={retrying}
            >
              {retrying ? "Trying again…" : "Try again"}
            </button>
          </p>
        ) : null}
        <Stats
          voteAverage={data.voteAverage}
          match={matchValue}
          voteCount={data.voteCount}
        />
        <RatingScale
          rating={entry?.rating}
          onRate={(n) => onUpsert(subject, "watched", n)}
        />
        <Actions
          movie={subject}
          entry={entry}
          imdb={imdb}
          onUpsert={onUpsert}
          onRemove={onRemove}
        />
        {entry?.status ? <LibraryStatus status={entry.status} /> : null}
        {creditsFailed &&
        !(resolved?.directors?.length || resolved?.cast?.length) ? (
          <p className="my-2 mb-3 text-xs leading-[1.45] text-muted">
            Credits could not be loaded. They will be tried again next launch.
          </p>
        ) : creditsReady === false &&
          !creditsFailed &&
          !(resolved?.directors?.length || resolved?.cast?.length) ? (
          <p className="my-2 mb-3 text-xs leading-[1.45] text-muted">
            Loading credits…
          </p>
        ) : null}
        {resolved?.directors ? (
          <Directors directors={resolved.directors} />
        ) : null}
        {resolved?.cast ? <CastList cast={resolved.cast} /> : null}
      </div>
    </aside>
  );
}
