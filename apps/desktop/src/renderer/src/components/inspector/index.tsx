import type { JSX } from "react";
import type {
  LibraryEntry,
  MovieDetails,
  MovieSummary,
  WatchStatus,
} from "../../../../shared/types";
import { languageName } from "../../../../shared/languages";
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
import OverlayScroll from "../overlay-scroll";
import MetaCaption from "./meta-caption";
import RatingScale from "./rating-scale";
import Stats from "./stats";

export default function Inspector({
  movie,
  details,
  entry,
  match,
  genreMap,
  creditsReady,
  creditsFailed,
  docked,
  busy = false,
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
  busy?: boolean;
  onUpsert: (
    movie: MovieSummary,
    status: WatchStatus,
    rating?: number,
  ) => Promise<void>;
  onRemove: (imdbId: string, mediaType: MediaType) => Promise<void>;
}): JSX.Element {
  if (!movie) {
    return (
      <aside className={inspectorClass(docked)}>
        <EmptyState />
      </aside>
    );
  }

  const data =
    details?.imdbId === movie.imdbId &&
    (details.mediaType ?? "movie") === (movie.mediaType ?? "movie")
      ? details
      : movie;
  const imdb = imdbUrl(details?.imdbId ?? movie.imdbId ?? entry?.imdbId);
  const genres = (
    details?.genres?.map((g) => g.name) ??
    data.genreIds.map((id) => genreMap.get(id)).filter(Boolean)
  )
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
  const runtime = formatRuntime(details?.runtime ?? movie.runtime);
  const seasons = formatSeasons(details?.seasonCount ?? movie.seasonCount);
  // Only the original language: the catalogue stores it before any other
  // spoken language.
  const originalLanguage = (
    details?.imdbId === movie.imdbId ? details.languages : movie.languages
  )?.[0];
  const language = originalLanguage ? languageName(originalLanguage) : null;
  const matchValue =
    match ?? ("match" in movie ? (movie as { match?: number }).match : null);
  const subject = details ?? movie;

  return (
    <aside
      className={`${inspectorClass(docked, true)} flex flex-col`}
      aria-label="Title details"
    >
      {/* The panel scrolls under an overlay thumb, so no scrollbar track
          narrows it and the poster can span it edge to edge. */}
      <OverlayScroll label="Title details content">
        <div className="max-inspect:grid max-inspect:grid-cols-[80px_minmax(0,1fr)] max-inspect:items-start">
          {/* Docked beside the results, the poster spans the panel edge to edge
          at its own 2:3 shape, so it fills its frame without cropping. */}
          <div className="relative aspect-2/3 w-full overflow-hidden hero-ph max-inspect:mt-4 max-inspect:ml-3 max-inspect:w-17">
            <HeroPoster
              key={data.posterPath || movie.posterPath || "none"}
              path={data.posterPath || movie.posterPath}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-18 hero-fade" />
          </div>
          <div
            className="min-w-0 animate-fade px-4 pt-4 pb-[18px] wrap-break-word"
            key={movie.imdbId}
          >
            <Heading
              title={data.title}
              rating={details?.certification ?? data.certification}
            />
            <MetaCaption
              parts={[
                titleKindLabel(data.titleKind),
                data.year,
                seasons,
                runtime,
                genres,
                language,
              ]}
              imdb={imdb}
            />
            <RatingScale
              rating={entry?.rating}
              disabled={busy}
              onRate={(n) => onUpsert(subject, "watched", n)}
            />
            <Actions
              movie={subject}
              entry={entry}
              busy={busy}
              onUpsert={onUpsert}
              onRemove={onRemove}
            />
            {details?.tagline ? (
              <div className="mb-2.5 text-[13px] text-accent-text italic">
                {details.tagline}
              </div>
            ) : null}
            <p className="mb-3.5 text-[13px] leading-description text-muted">
              {data.overview || movie.overview || "No synopsis available."}
            </p>
            <Stats
              voteAverage={data.voteAverage}
              match={matchValue}
              voteCount={data.voteCount}
            />
            {creditsFailed &&
            !(details?.directors?.length || details?.cast?.length) ? (
              <p className="my-2 mb-3 text-xs leading-copy text-muted">
                Credits could not be loaded. They will be tried again next
                launch.
              </p>
            ) : creditsReady === false &&
              !creditsFailed &&
              !(details?.directors?.length || details?.cast?.length) ? (
              <p className="my-2 mb-3 text-xs leading-copy text-muted">
                Loading cast and directors…
              </p>
            ) : null}
            {details?.directors ? (
              <Directors directors={details.directors} />
            ) : null}
            {details?.cast ? <CastList cast={details.cast} /> : null}
          </div>
        </div>
      </OverlayScroll>
    </aside>
  );
}
