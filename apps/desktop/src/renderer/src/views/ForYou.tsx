import {
  createForYouResults,
  visibleForYouItems,
} from "../lib/for-you-results";
import { useVisibleMedia, mergeTitleMedia } from "../lib/use-visible-media";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from "react";
import type {
  LibraryEntry,
  MovieSummary,
  RankingMode,
  TasteProfile,
} from "../../../shared/types";
import { titleKey } from "../../../shared/types";
import {
  formatRuntime,
  posterUrl,
  type RankedMovie,
} from "../../../shared/types";
import { AgeCaption } from "../components/movie-card";
import CatalogLoader from "../components/catalog-loader";
import OverlayScroll from "../components/overlay-scroll";
import VirtualList from "../components/virtual-list";
import { IconRefresh } from "../components/icons";
import { enterDelayMs } from "../motion";
import { cn } from "../lib/cn";
import {
  iconBtn,
  rankedRow,
  rankedThumb,
  segmentedCell,
  segmentedGroup,
} from "../lib/ui";

const RANKING_MODES: ReadonlyArray<{ value: RankingMode; label: string }> = [
  { value: "balanced", label: "Balanced" },
  { value: "same", label: "More like this" },
  { value: "diverse", label: "Surprise me" },
];

export default function ForYou({
  library,
  libraryRevision,
  profile,
  genreMap,
  selectedId,
  onOpen,
  onError,
  rankingMode,
  onRankingModeChange,
}: {
  library: LibraryEntry[];
  libraryRevision: number;
  profile: TasteProfile | null;
  genreMap: Map<number, string>;
  selectedId: string | null;
  onOpen: (movie: MovieSummary) => void;
  onError: (message: string) => void;
  rankingMode: RankingMode;
  onRankingModeChange: (mode: RankingMode) => void;
}): JSX.Element {
  const { containerRef, media } = useVisibleMedia();
  const results = useMemo(
    () => createForYouResults(() => window.api.forYou()),
    [],
  );
  const snapshot = useSyncExternalStore(results.subscribe, results.getSnapshot);
  const { result, loading } = snapshot;
  const [entering, setEntering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  function load(): Promise<void> {
    return results.refresh();
  }
  useEffect(() => {
    void results.refresh();
    return () => results.dispose();
  }, [rankingMode, libraryRevision, results]);
  useEffect(() => {
    onError(snapshot.error);
  }, [snapshot.error, onError]);
  useEffect(() => {
    if (snapshot.completion) setEntering(true);
  }, [snapshot.completion]);

  useEffect(() => {
    if (!entering) return;
    const handle = window.setTimeout(() => setEntering(false), 640);
    return () => window.clearTimeout(handle);
  }, [entering]);

  const ready = (result?.profile ?? profile)?.ready;

  const movies = visibleForYouItems(result?.movies ?? [], library).map(
    (movie) => mergeTitleMedia(movie, media),
  );
  const refreshing = loading && movies.length > 0;

  const taste = result?.profile ?? profile;
  const insights = result?.insights ?? [];

  return (
    <section
      ref={containerRef}
      className="grid min-h-0 flex-1 grid-cols-1 inspect:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-6 pt-6 pb-4 pl-6">
        <div className="flex shrink-0 flex-wrap items-end gap-4 pr-6">
          <div className="min-w-64 flex-1">
            <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-title">
              Ranked for you
            </h1>
            <p className="mt-1 mb-0 max-w-[60ch] text-sm leading-copy text-muted">
              Seeded from titles you rated highly, then re-ranked by genre,
              directors, cast, era, runtime habits and what you have watched
              lately.
            </p>
          </div>
          <div
            role="group"
            aria-label="Ranking mode"
            className={segmentedGroup("icon")}
          >
            {RANKING_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={rankingMode === mode.value}
                className={segmentedCell(rankingMode === mode.value, "icon")}
                onClick={() => onRankingModeChange(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={iconBtn(loading && "busy")}
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh ranking"
            title="Refresh ranking"
          >
            <IconRefresh className="size-4" />
          </button>
        </div>

        {!ready ? (
          <div className="mr-6 flex shrink-0 flex-col gap-1 rounded-app border border-line px-4 py-3 inset-accent">
            <h2 className="m-0 text-sm font-semibold">
              Your taste model needs a few ratings
            </h2>
            <p className="m-0 text-[13px] leading-copy text-muted">
              Rate at least three watched titles, or import your IMDb
              ratings.csv in Settings. Until then, rankings lean on public
              scores instead of your patterns.
            </p>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <OverlayScroll
            ref={scrollRef}
            className={cn(refreshing && "opacity-45")}
          >
            <VirtualList
              items={movies}
              scrollRef={scrollRef}
              getKey={titleKey}
              estimateSize={96}
              label="Ranked titles"
              renderItem={(movie, index) =>
                index === 0 ? (
                  <TopPick
                    movie={movie}
                    active={selectedId === titleKey(movie)}
                    onOpen={onOpen}
                  />
                ) : (
                  <RankedRow
                    movie={movie}
                    rank={index + 1}
                    active={selectedId === titleKey(movie)}
                    entering={entering}
                    onOpen={onOpen}
                  />
                )
              }
            />
          </OverlayScroll>
          {loading ? (
            <CatalogLoader
              label={
                refreshing ? "Updating ranking…" : "Ranking titles for you…"
              }
            />
          ) : null}
        </div>
      </div>

      <aside
        aria-label="Your taste model"
        className="hidden min-h-0 flex-col gap-6 overflow-auto border-l border-line bg-rail px-6 pt-6 pb-8 inspect:flex"
      >
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold">Your taste model</h2>
          <p className="m-0 text-[13px] leading-copy text-muted">
            Trained on everything you rate, finish, save or skip.
          </p>
        </div>
        <dl className="m-0 grid grid-cols-2 rounded-app border border-line">
          <TasteStat
            label="Rated"
            value={countLabel(taste?.ratedCount)}
            className="border-r border-b border-line"
          />
          <TasteStat
            label="Your average"
            value={
              taste?.ratedCount && Number.isFinite(taste.globalAvg)
                ? taste.globalAvg.toFixed(1)
                : "—"
            }
            className="border-b border-line"
          />
          <TasteStat
            label="Watchlist"
            value={countLabel(taste?.watchlistCount)}
            className="border-r border-line"
          />
          <TasteStat
            label="Usual runtime"
            value={
              taste?.runtimeMean && Number.isFinite(taste.runtimeMean)
                ? (formatRuntime(Math.round(taste.runtimeMean)) ?? "—")
                : "—"
            }
          />
        </dl>
        {taste?.topGenres?.length ? (
          <section className="flex flex-col gap-3">
            <h3 className="kicker">Genres you rate highest</h3>
            {taste.topGenres.slice(0, 5).map((genre) => (
              <div key={genre.id} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3 text-[13px]">
                  <span className="font-medium">
                    {genreMap.get(Number(genre.id)) ?? genre.name}
                  </span>
                  <span className="text-muted tabular">
                    avg {genre.avg} · {genre.count} rated
                  </span>
                </div>
                <span aria-hidden="true" className="block h-1 bg-track">
                  <span
                    className="block h-1 bg-accent"
                    style={{
                      width: `${Math.max(0, Math.min(100, (Number(genre.avg) || 0) * 10))}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {insights.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="kicker">What the ranker noticed</h3>
            {insights.map((text) => (
              <p
                key={text}
                className="m-0 rounded-control border border-line bg-canvas px-3 py-2.5 text-[13px] leading-copy"
              >
                {text}
              </p>
            ))}
          </section>
        ) : null}
      </aside>
    </section>
  );
}

function countLabel(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "—";
}

function TasteStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("flex flex-col-reverse gap-1 p-3", className)}>
      <dt className="text-xs tracking-kicker text-faint uppercase">{label}</dt>
      <dd className="m-0 text-xl font-semibold tabular">{value}</dd>
    </div>
  );
}

function Reasons({
  movie,
  highlightFirst = false,
}: {
  movie: RankedMovie;
  highlightFirst?: boolean;
}): JSX.Element | null {
  if (!movie.reasons.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {movie.reasons.map((reason, index) => (
        <span
          key={reason.label}
          className={cn(
            "max-w-full rounded-[3px] px-1.5 py-0.5 text-xs wrap-break-word",
            highlightFirst && index === 0
              ? "bg-accent/15 font-semibold text-accent-text"
              : "bg-wash-6 text-muted",
          )}
        >
          {reason.label} · {reason.detail}
        </span>
      ))}
    </span>
  );
}

function Thumb({
  movie,
  className,
}: {
  movie: RankedMovie;
  className: string;
}): JSX.Element {
  const src = posterUrl(movie.posterPath, "w185");
  return src ? (
    <img
      className={className}
      src={src}
      alt=""
      width={185}
      height={278}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div className={className} />
  );
}

function metaLine(movie: RankedMovie): string {
  return [
    movie.year,
    formatRuntime(movie.runtime),
    `IMDb ${movie.voteAverage.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function TopPick({
  movie,
  active,
  onOpen,
}: {
  movie: RankedMovie;
  active: boolean;
  onOpen: (movie: MovieSummary) => void;
}): JSX.Element {
  const match = Math.round(movie.match);
  return (
    <button
      type="button"
      data-imdb-id={movie.imdbId}
      className={cn(
        "mb-4 grid w-full cursor-pointer grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-5 rounded-app border bg-rail p-5 text-left text-inherit transition-colors duration-140",
        active ? "border-accent" : "border-line hover:border-control",
      )}
      onClick={() => onOpen(movie)}
    >
      <Thumb
        movie={movie}
        className="aspect-2/3 w-24 rounded-control object-cover poster-ph"
      />
      <span className="flex min-w-0 flex-col gap-2">
        <span className="kicker text-accent-text">No. 01 · Top pick</span>
        <span className="flex flex-col gap-1">
          <h2 className="m-0 text-xl leading-tight font-semibold tracking-tightish">
            {movie.title}
            <AgeCaption rating={movie.certification} />
          </h2>
          <span className="text-[13px] text-muted tabular">
            {metaLine(movie)}
          </span>
        </span>
        <Reasons movie={movie} highlightFirst />
      </span>
      <span className="flex w-28 flex-col gap-2 border-l border-line pl-5">
        <span className="kicker">Match</span>
        <span className="text-[28px] leading-none font-semibold text-accent-text tabular">
          {match}%
        </span>
        <span aria-hidden="true" className="block h-0.5 bg-track">
          <span
            className="block h-0.5 bg-accent"
            style={{ width: `${match}%` }}
          />
        </span>
      </span>
    </button>
  );
}

function RankedRow({
  movie,
  rank,
  active,
  entering,
  onOpen,
}: {
  movie: RankedMovie;
  rank: number;
  active: boolean;
  entering: boolean;
  onOpen: (movie: MovieSummary) => void;
}): JSX.Element {
  const match = Math.round(movie.match);
  return (
    <button
      className={rankedRow(
        active,
        cn(
          "grid-cols-[32px_36px_minmax(0,1fr)_112px]",
          entering && "animate-result-in enter-delay",
        ),
      )}
      data-imdb-id={movie.imdbId}
      style={
        {
          "--enter-delay": `${enterDelayMs(rank - 1, 1, 18)}ms`,
        } as CSSProperties
      }
      onClick={() => onOpen(movie)}
    >
      <span className="text-base font-semibold text-faint tabular">
        {String(rank).padStart(2, "0")}
      </span>
      <Thumb movie={movie} className={rankedThumb()} />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="m-0 text-sm font-semibold">
            {movie.title}
            <AgeCaption rating={movie.certification} />
          </h2>
          <span className="text-[13px] text-muted tabular">
            {metaLine(movie)}
          </span>
        </span>
        <Reasons movie={movie} />
      </span>
      <span className="flex flex-col items-end gap-2">
        <span className="text-base font-semibold text-accent-text tabular">
          {match}%
        </span>
        <span aria-hidden="true" className="block h-0.5 w-24 bg-track">
          <span
            className="block h-0.5 bg-accent"
            style={{ width: `${match}%` }}
          />
        </span>
      </span>
    </button>
  );
}
