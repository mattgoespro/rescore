import type { CSSProperties, JSX } from "react";
import type { MovieSummary, RankedMovie } from "../../../../shared/types";
import {
  formatRuntime,
  formatSeasons,
  posterUrl,
  titleKey,
  titleKindLabel,
} from "../../../../shared/types";
import { cn } from "../../lib/cn";
import Caption from "./caption";
import Poster from "./poster";
import RatingLine from "./rating-line";
import Title from "./title";

export { default as AgeCaption } from "./age-caption";

export default function MovieCard({
  movie,
  active,
  layout = "list",
  entering = false,
  enterDelay = 0,
  onOpen,
}: {
  movie: MovieSummary | RankedMovie;
  active?: boolean;
  layout?: "list" | "grid";
  entering?: boolean;
  enterDelay?: number;
  onOpen: (movie: MovieSummary) => void;
}): JSX.Element {
  const poster = posterUrl(movie.posterPath, "w185");
  const grid = layout === "grid";
  const runtime = formatRuntime(movie.runtime);
  const seasons = formatSeasons(movie.seasonCount);
  const kind =
    movie.titleKind && movie.titleKind !== "movie"
      ? titleKindLabel(movie.titleKind)
      : null;

  return (
    <button
      data-title-key={titleKey(movie)}
      data-imdb-id={movie.imdbId}
      className={cn(
        grid
          ? "group flex w-full flex-col items-stretch gap-2 rounded-control border-0 bg-transparent p-0 pb-2 text-left text-inherit"
          : "grid w-full grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-none border-0 border-b border-line bg-transparent px-3 py-2 text-left text-inherit transition-colors duration-140",
        !grid && !active && "hover:bg-wash-3",
        !grid && active && "bg-selected inset-accent",
        entering && "animate-result-in enter-delay",
      )}
      type="button"
      style={{ "--enter-delay": `${enterDelay}ms` } as CSSProperties}
      onClick={() => onOpen(movie)}
    >
      <Poster
        src={poster}
        status={movie.posterStatus}
        grid={grid}
        active={active}
      />
      <div
        className={
          grid
            ? "flex w-full min-w-0 flex-col gap-1"
            : "flex min-w-0 flex-col gap-0.5"
        }
      >
        <Title title={movie.title} />
        <Caption
          compact={!grid}
          kind={kind}
          year={movie.year}
          seasons={seasons}
          runtime={runtime}
        />
        <RatingLine
          compact={!grid}
          voteAverage={movie.voteAverage}
          voteCount={movie.voteCount}
          certification={movie.certification}
        />
      </div>
    </button>
  );
}
