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
          ? "flex w-full flex-col items-stretch gap-1.5 rounded-none border-0 bg-transparent p-0 pb-2 text-left text-inherit shadow-none"
          : "mr-(--rail-gutter,14px) grid w-auto grid-cols-[44px_minmax(0,1fr)] items-start gap-2.5 rounded-none border-0 border-b border-line bg-transparent py-2 pr-2.5 pl-1.5 text-left text-inherit transition-[background,box-shadow] duration-140",
        !grid && !active && "hover:bg-wash-3",
        !grid && active && "inset-accent bg-accent-soft",
        entering && "animate-result-in enter-delay",
      )}
      type="button"
      style={{ "--enter-delay": `${enterDelay}ms` } as CSSProperties}
      onClick={() => onOpen(movie)}
    >
      <Poster src={poster} grid={grid} active={active} />
      <div className={grid ? "min-w-0 w-full" : "min-w-0"}>
        <Title title={movie.title} grid={grid} />
        <Caption
          compact={!grid}
          kind={kind}
          year={movie.year}
          seasons={seasons}
          runtime={runtime}
          certification={movie.certification}
        />
        <RatingLine
          compact={!grid}
          voteAverage={movie.voteAverage}
          voteCount={movie.voteCount}
        />
      </div>
    </button>
  );
}
