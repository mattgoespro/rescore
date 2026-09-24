import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";
import type {
  ForYouResult,
  MovieSummary,
  RankingMode,
  TasteProfile,
} from "../../../shared/types";
import { titleKey } from "../../../shared/types";
import { formatRuntime, posterUrl } from "../../../shared/types";
import { AgeCaption } from "../components/movie-card";
import CatalogLoader from "../components/catalog-loader";
import OverlayScroll from "../components/overlay-scroll";
import { IconRefresh } from "../components/icons";
import { enterDelayMs } from "../motion";
import { cn } from "../lib/cn";
import { iconBtn, rankedRow, rankedThumb } from "../lib/ui";

export default function ForYou({
  profile,
  genreMap,
  selectedId,
  onOpen,
  onError,
  rankingMode,
}: {
  profile: TasteProfile | null;
  genreMap: Map<number, string>;
  selectedId: string | null;
  onOpen: (movie: MovieSummary) => void;
  onError: (message: string) => void;
  rankingMode: RankingMode;
}): JSX.Element {
  const [result, setResult] = useState<ForYouResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);
  const requestId = useRef(0);

  async function load(): Promise<void> {
    const id = ++requestId.current;
    setLoading(true);
    onError("");
    try {
      const next = await window.api.forYou();
      if (id !== requestId.current) return;
      setResult(next);
      setEntering(true);
      void applyAgeRatings(id, next.movies);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Could not build rankings",
      );
    } finally {
      setLoading(false);
    }
  }

  async function applyAgeRatings(
    request: number,
    movies: MovieSummary[],
  ): Promise<void> {
    const ids = movies
      .filter((movie) => !movie.certification)
      .map((movie) => movie.imdbId);
    if (!ids.length) return;
    try {
      const rows = await window.api.fillMedia(ids);
      if (request !== requestId.current) return;
      const ratings = new Map(
        rows.map((row) => [row.id, row.certification || undefined]),
      );
      setResult((current) => {
        if (!current) return current;
        return {
          ...current,
          movies: current.movies.map((movie) => {
            const certification = ratings.get(movie.imdbId);
            return certification ? { ...movie, certification } : movie;
          }),
        };
      });
    } catch {
      /* age badges stay empty until the next refresh */
    }
  }

  useEffect(() => {
    void load();
  }, [rankingMode]);

  useEffect(() => {
    if (!entering) return;
    const handle = window.setTimeout(() => setEntering(false), 640);
    return () => window.clearTimeout(handle);
  }, [entering]);

  const ready = (result?.profile ?? profile)?.ready;

  const movies = result?.movies ?? [];
  const refreshing = loading && movies.length > 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-[22px] flex shrink-0 items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-[28px] font-650 tracking-title">
            Ranked for you
          </h2>
          <p className="mt-1.5 mb-0 max-w-[640px] text-[13px] leading-[1.45] text-muted">
            Seeded from movies you rated highly, then re-ranked with genre
            affinity, directors, cast, era, runtime habits, and how you have
            been watching lately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={iconBtn(loading && "busy")}
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh ranking"
            title="Refresh ranking"
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      {!ready ? (
        <div className="shrink-0 px-4 py-9 text-center text-muted">
          <h3 className="mt-0 mb-2 text-[22px] tracking-[-0.03em] text-ink">
            Your taste model needs a few ratings
          </h3>
          <p>
            Rate at least three watched movies (or import your IMDb ratings.csv
            in Settings). Until then, rankings lean on public scores instead of
            your patterns.
          </p>
        </div>
      ) : null}

      <div className="mb-[22px] grid shrink-0 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        {(result?.insights ?? []).map((text) => (
          <div
            className="border-b border-line py-3.5 text-[13px] leading-[1.45] text-muted"
            key={text}
          >
            {text}
          </div>
        ))}
        {(result?.profile.topGenres ?? profile?.topGenres ?? [])
          .slice(0, 3)
          .map((genre) => (
            <div
              className="border-b border-line py-3.5 text-[13px] leading-[1.45] text-muted"
              key={genre.id}
            >
              {genreMap.get(Number(genre.id)) ?? genre.name}: avg {genre.avg}{" "}
              across {genre.count} rated titles.
            </div>
          ))}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <OverlayScroll className={cn(refreshing && "opacity-45")}>
          {loading && !movies.length ? (
            <CatalogLoader label="Ranking titles for you…" />
          ) : null}
          {movies.map((movie, index) => (
            <button
              className={rankedRow(
                selectedId === titleKey(movie),
                cn(
                  "mr-[var(--rail-gutter,14px)]",
                  entering && "animate-result-in enter-delay",
                ),
              )}
              key={titleKey(movie)}
              style={
                {
                  "--enter-delay": `${enterDelayMs(index, 1, 18)}ms`,
                } as CSSProperties
              }
              onClick={() => onOpen(movie)}
            >
              <div className="tabular pt-0.5 text-center text-xl font-bold tracking-title text-accent">
                {String(index + 1).padStart(2, "0")}
              </div>
              {posterUrl(movie.posterPath, "w185") ? (
                <img
                  className={rankedThumb()}
                  src={posterUrl(movie.posterPath, "w185") ?? ""}
                  alt=""
                />
              ) : (
                <div className={rankedThumb()} />
              )}
              <div className="min-w-0 overflow-hidden">
                <h3 className="mt-0 mb-1 text-[15px] font-650 tracking-tightish">
                  {movie.title}
                  <AgeCaption rating={movie.certification} />
                  <span className="ml-1.5 inline text-xs leading-[1.45] text-muted tabular">
                    {movie.year}
                  </span>
                </h3>
                <div className="text-xs leading-[1.45] text-muted tabular">
                  {[
                    movie.year,
                    formatRuntime(movie.runtime),
                    `IMDb ${movie.voteAverage.toFixed(1)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {movie.reasons.map((reason) => (
                    <span
                      className="max-w-full break-words rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
                      key={reason.label}
                    >
                      {reason.label}: {reason.detail}
                    </span>
                  ))}
                </div>
              </div>
              <div className="shrink-0 pt-0.5 tabular text-[28px] leading-none font-bold tracking-[-0.06em] text-accent">
                {Math.round(movie.match)}
                <small className="mt-1.5 block text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
                  match
                </small>
              </div>
            </button>
          ))}
        </OverlayScroll>
        {refreshing ? (
          <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center bg-canvas/42">
            <CatalogLoader label="Updating ranking…" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
