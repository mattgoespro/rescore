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
  const [layout, setLayout] = useState<"list" | "grid">("grid");
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
  // Library writes do not search again: visibleDiscoverItems hides watched,
  // watchlist, and skipped titles from `library`, and taste ranking applies
  // from the next search. Only a ranking mode change re-ranks what is loaded.
  const previousRankingMode = useRef(rankingMode);
  useEffect(() => {
    if (previousRankingMode.current === rankingMode) return;
    previousRankingMode.current = rankingMode;
    void results.refresh();
  }, [rankingMode, results]);
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
      className="grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr_auto] inspect:grid-cols-[288px_minmax(0,1fr)_minmax(320px,400px)] inspect:grid-rows-none"
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
      <div className="flex min-h-0 min-w-0 flex-col pt-6 pr-0 pb-4 pl-6">
        <div className="mb-5 flex items-end justify-between gap-4 pr-6">
          <div className="min-w-0">
            <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-title">
              Discover
            </h1>
            <p
              className="m-0 mt-1 text-sm text-muted tabular"
              role="status"
              aria-live="polite"
            >
              {countLabel}
            </p>
          </div>
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
                onClick={() => setLayout("list")}
              >
                <IconList className="size-3.5" />
                <span aria-hidden="true">List</span>
              </button>
              <button
                type="button"
                className={segmentedCell(layout === "grid", "icon")}
                aria-label="Grid view"
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                <IconGrid className="size-3.5" />
                <span aria-hidden="true">Grid</span>
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
              <div className="col-span-full flex flex-col items-center gap-2 px-4 py-12 text-center">
                <h2 className="m-0 text-base font-semibold text-ink">
                  No titles match these filters
                </h2>
                <p className="m-0 max-w-90 text-sm leading-copy text-muted">
                  Lower the quality floor, widen the year range or clear a genre
                  to see more.
                </p>
              </div>
            ) : null}
            {hasResults ? (
              <InfiniteScroll
                dataLength={visibleItems.length}
                next={loadMore}
                hasMore={canLoadMore()}
                loader={
                  <div
                    className="my-4 mb-2 flex items-center justify-center gap-2.5 text-[13px] text-muted"
                    role="status"
                  >
                    Loading more titles…
                  </div>
                }
                endMessage={
                  <p className="my-6 text-center text-[13px] text-faint">
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
