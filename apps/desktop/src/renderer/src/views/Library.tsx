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
import { btn, rankedRow, rankedThumb } from "../lib/ui";
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

  const avg = average(
    library.filter((e) => e.rating != null).map((e) => e.rating as number),
  );
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

  return (
    <section ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-650 tracking-title">
            Watch patterns
          </h1>
          <p className="mt-1.5 mb-0 max-w-160 text-[13px] leading-copy text-muted">
            Everything you rate, finish, save, or skip trains the ranker.
            Average score {avg ? avg.toFixed(1) : "—"}/10 across{" "}
            {library.filter((e) => e.rating != null).length} ratings.
          </p>
        </div>
      </div>
      <div className="mb-[22px] grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        {topGenres.map(([name, count]) => (
          <div
            className="border-b border-line py-3.5 text-[13px] leading-copy text-muted"
            key={name}
          >
            {name} shows up in {count} watched titles.
          </div>
        ))}
      </div>
      <div className="mb-4 flex gap-1.5">
        {(["watched", "watchlist", "skipped", "all"] as const).map((id) => (
          <button
            key={id}
            className={btn(tab === id && "primary")}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {id}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <div className="relative min-h-40 flex-1">
          <LoadingOverlay
            busy={false}
            completeText="Nothing in this shelf yet"
            detail="Search for a movie you know well and give it a rating to start the pattern."
          />
        </div>
      ) : (
        <OverlayScroll ref={scrollRef}>
          <VirtualList
            items={rows}
            scrollRef={scrollRef}
            getKey={titleKey}
            estimateSize={100}
            label="Library titles"
            renderItem={(item) => {
              const entry = mergeTitleMedia(item, media);
              return (
                <div
                  className={rankedRow(
                    selectedId === titleKey(entry),
                    "relative isolate",
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
                  <div className="text-center text-xl font-bold tracking-title text-accent-text tabular">
                    {entry.rating ?? "–"}
                  </div>
                  {posterUrl(entry.posterPath, "w185") ? (
                    <img
                      className={rankedThumb()}
                      src={posterUrl(entry.posterPath, "w185") ?? ""}
                      alt=""
                      width={52}
                      height={78}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={rankedThumb()} />
                  )}
                  <div className="min-w-0 wrap-break-word">
                    <h2 className="mt-0 mb-1 text-[15px] font-650 tracking-tightish">
                      {entry.title}
                      <AgeCaption rating={entry.certification} />
                    </h2>
                    <div className="text-xs leading-copy text-muted tabular">
                      {entry.year} · {titleKindLabel(entry.titleKind)} ·{" "}
                      {entry.status} ·{" "}
                      {entry.genreIds
                        .map((id) => genreMap.get(id))
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    className={`${btn("ghost")} relative z-2`}
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
