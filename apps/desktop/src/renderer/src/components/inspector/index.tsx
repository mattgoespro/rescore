import type { JSX } from "react";
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

export default function Inspector({
  movie,
  details,
  entry,
  match,
  genreMap,
  creditsReady,
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
  docked?: boolean;
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
  const matchValue =
    match ?? ("match" in movie ? (movie as { match?: number }).match : null);
  const subject = details ?? movie;

  return (
    <aside className={inspectorClass(docked)}>
      <div className="hero-ph relative aspect-[2/3] w-full overflow-hidden">
        <HeroPoster key={data.posterPath ?? "none"} path={data.posterPath} />
        <div className="hero-fade pointer-events-none absolute inset-x-0 bottom-0 h-[72px]" />
      </div>
      <div className="animate-fade px-4 pt-4 pb-[18px]" key={movie.imdbId}>
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
          ]}
        />
        {details?.tagline ? (
          <div className="mb-2.5 text-[13px] text-accent-2 italic">
            {details.tagline}
          </div>
        ) : null}
        <p className="mb-3.5 text-[13px] leading-[1.55] text-muted">
          {data.overview || "No synopsis available."}
        </p>
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
        {creditsReady === false &&
        !(details?.directors?.length || details?.cast?.length) ? (
          <p className="my-2 mb-3 text-xs leading-[1.45] text-muted">
            Loading credits…
          </p>
        ) : null}
        {details?.directors ? (
          <Directors directors={details.directors} />
        ) : null}
        {details?.cast ? <CastList cast={details.cast} /> : null}
      </div>
    </aside>
  );
}
