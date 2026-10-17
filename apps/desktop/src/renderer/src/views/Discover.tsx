import {
  createDiscoverResults,
  visibleDiscoverItems,
} from "../lib/discover-results";
import { useVisibleMedia, mergeTitleMedia } from "../lib/use-visible-media";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from "react";
import InfiniteScroll from "react-infinite-scroll-component";
import type {
  DiscoverFilters,
  Genre,
  LibraryEntry,
  RankingMode,
  MovieSummary,
  SearchHistoryEntry,
} from "../../../shared/types";
import { titleKey } from "../../../shared/types";
import {
  applySearchHistory,
  matchesSearchHistory,
  shouldRecordSearchHistory,
  snapshotSearchHistory,
} from "../../../shared/search-history";
import {
  listSearchHistory,
  removeSearchHistory,
  saveSearchHistory,
} from "../lib/search-history-store";
import FilterPanel from "../components/filter-panel";
import MovieCard from "../components/movie-card";
import OverlayScroll from "../components/overlay-scroll";
import VirtualList from "../components/virtual-list";
import CatalogLoader from "../components/catalog-loader";
import { IconGrid, IconList } from "../components/icons";
import { enterDelayMs } from "../motion";
import { cn } from "../lib/cn";
import { discoverCountLabel } from "../lib/discover-count";
import { segmentedCell, segmentedGroup } from "../lib/ui";

const SEARCH_DEBOUNCE_MS = 400;
const SCROLLABLE_TARGET_ID = "discover-results-scroll";

export default function Discover({
  library,
  libraryRevision,
  rankingMode,
  filters,
  setFilters,
  genres,
  selectedId,
  onOpen,
  onError,
  inspector,
}: {
  library: LibraryEntry[];
  libraryRevision: number;
  rankingMode: RankingMode;
  filters: DiscoverFilters;
  setFilters: (filters: DiscoverFilters) => void;
  genres: Genre[];
  selectedId: string | null;
  onOpen: (movie: MovieSummary) => void;
  onError: (message: string) => void;
  inspector: ReactNode;
}): JSX.Element {
  const { containerRef, media } = useVisibleMedia();
  const results = useMemo(
    () => createDiscoverResults((filters) => window.api.discover(filters)),
    [],
  );
  const snapshot = useSyncExternalStore(results.subscribe, results.getSnapshot);
  const { items, totalResults, loading } = snapshot;
  const visibleItems = visibleDiscoverItems(snapshot.items, library, filters);
  const [entering, setEntering] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const openedId = useRef<string | null>(null);
  const filtersRef = useRef(filters);
  const genresRef = useRef(genres);
  const historySession = useRef({ saved: false });
  const replayKey = useRef<string | null>(null);
  const [historyReplay, setHistoryReplay] = useState(0);
  filtersRef.current = filters;
  genresRef.current = genres;

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        ...filters,
        page: 1,
      }),
    [filters],
  );

  useEffect(() => {
    historySession.current = { saved: replayKey.current === filterKey };
    replayKey.current = null;
  }, [filterKey, historyReplay]);

  useEffect(() => {
    void listSearchHistory().then(setHistory);
  }, []);

  useEffect(() => {
    results.configure(filtersRef.current);
    const handle = window.setTimeout(() => {
      void results.replace();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
      results.cancel();
    };
  }, [filterKey, historyReplay, results]);
  const previousRevision = useRef({ libraryRevision, rankingMode });
  useEffect(() => {
    const previous = previousRevision.current;
    previousRevision.current = { libraryRevision, rankingMode };
    if (
      previous.libraryRevision !== libraryRevision ||
      previous.rankingMode !== rankingMode
    )
      void results.refresh();
  }, [libraryRevision, rankingMode, results]);
  useEffect(() => () => results.dispose(), [results]);
  useEffect(() => {
    onError(snapshot.error);
  }, [snapshot.error, onError]);
  useEffect(() => {
    if (!snapshot.completion?.reset) return;
    scrollerRef.current?.scrollTo({ top: 0 });
    const first = snapshot.items[0];
    if (first) {
      openedId.current = first.imdbId;
      onOpen(first);
    }
    setEntering(true);
    recordSearchHistory();
  }, [snapshot.completion]);
  function canLoadMore(): boolean {
    return !loading && !snapshot.loadingMore && snapshot.canLoadMore;
  }
  function loadMore(): void {
    void results.loadMore();
  }

  function handleCardOpen(movie: MovieSummary): void {
    openedId.current = movie.imdbId;
    onOpen(movie);
  }

  function recordSearchHistory(): void {
    if (historySession.current.saved) return;
    if (
      history.some((entry) => matchesSearchHistory(filtersRef.current, entry))
    ) {
      historySession.current.saved = true;
      return;
    }
    const snapshot = snapshotSearchHistory(
      filtersRef.current,
      genresRef.current,
    );
    if (
      !shouldRecordSearchHistory({
        saved: historySession.current.saved,
        snapshot,
      })
    ) {
      historySession.current.saved = true;
      return;
    }
    historySession.current.saved = true;
    void saveSearchHistory(snapshot)
      .then(setHistory)
      .catch(() => {
        historySession.current.saved = false;
      });
  }

  useEffect(() => {
    if (!entering) return;
    const handle = window.setTimeout(() => setEntering(false), 640);
    return () => window.clearTimeout(handle);
  }, [entering]);

  const hasResults = visibleItems.length > 0;

  const refreshing = loading && hasResults;
  const countLabel = discoverCountLabel(totalResults, loading && !items.length);
  const activeHistoryId =
    history.find((entry) => matchesSearchHistory(filters, entry))?.id ?? null;

  return (
    <section
      ref={containerRef}
      className="grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr_auto] inspect:grid-cols-[280px_minmax(0,1fr)_minmax(280px,400px)] inspect:grid-rows-none"
    >
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        genres={genres}
        history={history}
        activeHistoryId={activeHistoryId}
        onApplyHistory={(entry) => {
          const next = applySearchHistory(filters, entry);
          replayKey.current = JSON.stringify({ ...next, page: 1 });
          setFilters(next);
          setHistoryReplay((revision) => revision + 1);
        }}
        onRemoveHistory={(id) => {
          void removeSearchHistory(id).then(setHistory);
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-col pt-5 pr-0 pb-4 pl-4.5">
        <div className="mb-2 flex items-center justify-between gap-3 pr-4.5">
          <h1 className="m-0 text-[22px] font-650 tracking-title">
            Results
            <span
              className="ml-2 text-xs font-medium text-muted"
              role="status"
              aria-live="polite"
            >
              {countLabel}
            </span>
          </h1>
          <div className="flex items-center gap-2.5">
            <div
              className={segmentedGroup("icon")}
              role="group"
              aria-label="Result layout"
            >
              <button
                type="button"
                className={segmentedCell(layout === "list", "icon")}
                aria-label="List view"
                aria-pressed={layout === "list"}
                title="List"
                onClick={() => setLayout("list")}
              >
                <IconList className="size-3.75" />
              </button>
              <button
                type="button"
                className={segmentedCell(layout === "grid", "icon")}
                aria-label="Grid view"
                aria-pressed={layout === "grid"}
                title="Grid"
                onClick={() => setLayout("grid")}
              >
                <IconGrid className="size-3.75" />
              </button>
            </div>
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <OverlayScroll
            ref={scrollerRef}
            id={SCROLLABLE_TARGET_ID}
            className={cn(refreshing && "opacity-45")}
          >
            {!loading && !visibleItems.length ? (
              <div className="col-span-full px-4 py-6 text-center text-muted">
                <h2 className="mt-0 mb-2 text-lg tracking-[-0.03em] text-ink">
                  No titles in this slice
                </h2>
                <p>Loosen the vote floor or year window to see more films.</p>
              </div>
            ) : null}
            {hasResults ? (
              <InfiniteScroll
                dataLength={visibleItems.length}
                next={loadMore}
                hasMore={canLoadMore()}
                loader={
                  <div
                    className="my-4 mb-2 flex items-center justify-center gap-2.5 text-xs text-muted"
                    role="status"
                  >
                    Loading more titles…
                  </div>
                }
                endMessage={
                  <p className="my-5 text-center text-xs text-muted">
                    You have reached the end of these results.
                  </p>
                }
                scrollableTarget={SCROLLABLE_TARGET_ID}
              >
                <VirtualList
                  items={visibleItems}
                  scrollRef={scrollerRef}
                  getKey={titleKey}
                  grid={layout === "grid"}
                  estimateSize={90}
                  label="Search results"
                  renderItem={(item, index) => {
                    const movie = mergeTitleMedia(item, media);
                    return (
                      <MovieCard
                        key={titleKey(movie)}
                        movie={movie}
                        active={selectedId === titleKey(movie)}
                        layout={layout}
                        entering={entering}
                        enterDelay={enterDelayMs(
                          index,
                          1,
                          layout === "grid" ? 36 : 18,
                        )}
                        onOpen={handleCardOpen}
                      />
                    );
                  }}
                />
              </InfiniteScroll>
            ) : null}
          </OverlayScroll>
          {loading ? (
            <CatalogLoader
              label={
                refreshing ? "Updating results…" : "Searching the catalog…"
              }
            />
          ) : null}
        </div>
      </div>
      {inspector}
    </section>
  );
}
