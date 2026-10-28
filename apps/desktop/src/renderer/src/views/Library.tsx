import LoadingOverlay from "../components/loading-overlay";
import { useVisibleMedia, mergeTitleMedia } from "../lib/use-visible-media";
import { useMemo, useRef, useState, type JSX } from "react";
import type {
  LibraryEntry,
  MovieSummary,
  WatchStatus,
} from "../../../shared/types";
import { posterUrl, titleKey, titleKindLabel } from "../../../shared/types";
import { AgeCaption } from "../components/movie-card";
import { cn } from "../lib/cn";
import { btn, rankedRow, rankedThumb } from "../lib/ui";

const SHELVES = [
  { id: "watched", label: "Watched" },
  { id: "watchlist", label: "Watchlist" },
  { id: "skipped", label: "Not interested" },
  { id: "all", label: "All" },
] as const;
import OverlayScroll from "../components/overlay-scroll";
import VirtualList from "../components/virtual-list";

export default function Library({
  library,
  genreMap,
  selectedId,
  onOpen,
  onRemove,
  busy,
}: {
  library: LibraryEntry[];
  genreMap: Map<number, string>;
  selectedId: string | null;
  onOpen: (movie: MovieSummary) => void;
  onRemove: (id: string, mediaType: LibraryEntry["mediaType"]) => Promise<void>;
  busy: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<WatchStatus | "all">("watched");
  const { containerRef, media } = useVisibleMedia();
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const filtered =
      tab === "all" ? library : library.filter((e) => e.status === tab);
    return [...filtered].sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.ratedAt ?? b.updatedAt).localeCompare(a.ratedAt ?? a.updatedAt),
    );
  }, [library, tab]);

  const rated = library.filter((e) => e.rating != null);
  const avg = average(rated.map((e) => e.rating as number));
  const histogram = Array.from({ length: 10 }, (_, i) => ({
    score: i + 1,
    count: rated.filter((e) => Math.round(e.rating as number) === i + 1).length,
  }));
  const histogramPeak = Math.max(1, ...histogram.map((bar) => bar.count));
  const genreCounts = new Map<string, number>();
  for (const entry of library.filter((e) => e.status === "watched")) {
    for (const id of entry.genreIds) {
      const name = genreMap.get(id) ?? "Other";
      genreCounts.set(name, (genreCounts.get(name) ?? 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const genrePeak = Math.max(1, ...topGenres.map(([, count]) => count));
  const shelfCount = (id: WatchStatus | "all"): number =>
    id === "all"
      ? library.length
      : library.filter((e) => e.status === id).length;

  return (
    <section ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-title">
          Library
        </h1>
        <p className="m-0 text-sm leading-copy text-muted">
          Everything you rate, finish, save or skip trains the ranker.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-4">
        <section className="flex min-w-80 flex-[2_1_420px] flex-col gap-4 rounded-app border border-line bg-rail p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-base font-semibold">How you rate</h2>
            <span className="text-[13px] text-muted tabular">
              {rated.length ? (
                <>
                  Average{" "}
                  <strong className="font-semibold text-ink">
                    {avg.toFixed(1)}
                  </strong>{" "}
                  across {rated.length.toLocaleString()} ratings
                </>
              ) : (
                "No ratings yet"
              )}
            </span>
          </div>
          <div
            role="img"
            aria-label={`Ratings from 1 to 10: ${histogram
              .map((bar) => `${bar.score}: ${bar.count}`)
              .join(", ")}`}
            className="flex flex-col gap-1.5"
          >
            <div className="grid h-20 grid-cols-10 items-end gap-2 border-b border-line">
              {histogram.map((bar) => (
                <span
                  key={bar.score}
                  className={cn(
                    "block rounded-t-[2px]",
                    bar.score >= 8 ? "bg-accent" : "bg-track",
                  )}
                  style={{
                    height: `${Math.max(bar.count ? 4 : 0, (bar.count / histogramPeak) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <div aria-hidden="true" className="grid grid-cols-10 gap-2">
              {histogram.map((bar) => (
                <span
                  key={bar.score}
                  className="text-center text-xs text-faint tabular"
                >
                  {bar.score}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="flex min-w-72 flex-[1_1_300px] flex-col gap-4 rounded-app border border-line bg-rail p-5">
          <h2 className="m-0 text-base font-semibold">Most watched genres</h2>
          {topGenres.length ? (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {topGenres.map(([name, count]) => (
                <li
                  key={name}
                  className="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-3 text-[13px]"
                >
                  <span className="truncate">{name}</span>
                  <span aria-hidden="true" className="block h-1 bg-track">
                    <span
                      className="block h-1 bg-accent"
                      style={{ width: `${(count / genrePeak) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-muted tabular">{count}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-[13px] text-muted">
              Mark titles as watched to see your genres.
            </p>
          )}
        </section>
      </div>

      <div
        role="tablist"
        aria-label="Shelves"
        className="flex shrink-0 gap-6 border-b border-line"
      >
        {SHELVES.map((shelf) => (
          <button
            key={shelf.id}
            type="button"
            role="tab"
            aria-selected={tab === shelf.id}
            className={cn(
              "h-11 border-0 bg-transparent p-0 text-sm transition-colors duration-140",
              tab === shelf.id
                ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-accent)]"
                : "font-medium text-muted hover:text-ink",
            )}
            onClick={() => setTab(shelf.id)}
          >
            {shelf.label}
            <span className="ml-1.5 text-xs text-faint tabular">
              {shelfCount(shelf.id).toLocaleString()}
            </span>
          </button>
        ))}
      </div>
      {!rows.length ? (
        <div className="relative min-h-40 flex-1">
          <LoadingOverlay
            busy={false}
            completeText="Nothing in this shelf yet"
            detail="Search for a title you know well and rate it to start the pattern."
          />
        </div>
      ) : (
        <OverlayScroll ref={scrollRef}>
          <VirtualList
            items={rows}
            scrollRef={scrollRef}
            getKey={titleKey}
            estimateSize={78}
            label="Library titles"
            renderItem={(item) => {
              const entry = mergeTitleMedia(item, media);
              return (
                <div
                  className={rankedRow(
                    selectedId === titleKey(entry),
                    "relative isolate grid-cols-[32px_36px_minmax(0,1fr)_auto]",
                  )}
                  key={titleKey(entry)}
                  data-imdb-id={entry.imdbId}
                >
                  <button
                    type="button"
                    className="absolute inset-0 z-1 border-0 bg-transparent p-0"
                    aria-label={`Open ${entry.title}`}
                    onClick={() =>
                      onOpen({
                        mediaType: entry.mediaType ?? "movie",
                        titleKind:
                          entry.titleKind ??
                          (entry.mediaType === "tv" ? "tv" : "movie"),
                        imdbId: entry.imdbId,
                        title: entry.title,
                        overview: entry.overview ?? "",
                        posterPath: entry.posterPath ?? null,
                        backdropPath: entry.backdropPath ?? null,
                        releaseDate: entry.releaseDate ?? "",
                        year: entry.year,
                        genreIds: entry.genreIds,
                        originalLanguage: entry.originalLanguage ?? "",
                        popularity: 0,
                        voteAverage: entry.voteAverage,
                        voteCount: entry.voteCount,
                        adult: false,
                        runtime: entry.runtime,
                        certification: entry.certification,
                        directorIds: entry.directorIds,
                        directorNames: entry.directorNames,
                        castIds: entry.castIds,
                        castNames: entry.castNames,
                      })
                    }
                  />
                  {entry.rating != null ? (
                    <span
                      className="grid size-8 place-items-center rounded-control bg-accent/15 text-[13px] font-semibold text-accent-text tabular"
                      aria-label={`Your rating ${entry.rating} out of 10`}
                    >
                      {entry.rating}
                    </span>
                  ) : (
                    <span
                      className="grid size-8 place-items-center rounded-control border border-line text-[13px] text-faint"
                      aria-label="Not rated"
                    >
                      –
                    </span>
                  )}
                  {posterUrl(entry.posterPath, "w185") ? (
                    <img
                      className={rankedThumb()}
                      src={posterUrl(entry.posterPath, "w185") ?? ""}
                      alt=""
                      width={36}
                      height={54}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={rankedThumb()} />
                  )}
                  <div className="flex min-w-0 flex-col gap-1 wrap-break-word">
                    <h2 className="m-0 text-sm font-semibold">
                      {entry.title}
                      <AgeCaption rating={entry.certification} />
                    </h2>
                    <div className="text-[13px] leading-copy text-muted tabular">
                      {[
                        entry.year,
                        titleKindLabel(entry.titleKind),
                        ...entry.genreIds
                          .map((id) => genreMap.get(id))
                          .filter(Boolean)
                          .slice(0, 3),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    className={`${btn("ghost", "compact")} relative z-2`}
                    disabled={busy}
                    aria-label={`Remove ${entry.title} from library`}
                    onClick={async (event) => {
                      event.stopPropagation();
                      await onRemove(entry.imdbId, entry.mediaType);
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            }}
          />
        </OverlayScroll>
      )}
    </section>
  );
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
