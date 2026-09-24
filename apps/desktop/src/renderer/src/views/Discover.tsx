import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import InfiniteScroll from "react-infinite-scroll-component";
import type {
  DiscoverFilters,
  Genre,
  MovieSummary,
  RankedMovie,
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
import CatalogLoader from "../components/catalog-loader";
import { IconGrid, IconList } from "../components/icons";
import { enterDelayMs, gridColumnCount } from "../motion";
import { cn } from "../lib/cn";
import { segmentedCell, segmentedGroup } from "../lib/ui";
import { canLoadMoreFromPage } from "../../../main/discover-paging";

const SEARCH_DEBOUNCE_MS = 400;
const SCROLLABLE_TARGET_ID = "discover-results-scroll";

export default function Discover({
  filters,
  setFilters,
  genres,
  profileReady,
  selectedId,
  onOpen,
  onError,
  inspector,
}: {
  filters: DiscoverFilters;
  setFilters: (filters: DiscoverFilters) => void;
  genres: Genre[];
  profileReady?: boolean;
  selectedId: string | null;
  onOpen: (movie: MovieSummary) => void;
  onError: (message: string) => void;
  inspector: ReactNode;
}): JSX.Element {
  const [items, setItems] = useState<RankedMovie[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [gridCols, setGridCols] = useState(1);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const filtersRef = useRef(filters);
  const genresRef = useRef(genres);
  const pageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const loadingRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const lastPageFullRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const historySession = useRef({ saved: false });
  filtersRef.current = filters;
  genresRef.current = genres;
  pageRef.current = page;
  totalPagesRef.current = totalPages;
  loadingRef.current = loading;

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        ...filters,
        page: 1,
      }),
    [filters],
  );

  useEffect(() => {
    historySession.current = { saved: false };
  }, [filterKey]);

  useEffect(() => {
    void listSearchHistory().then(setHistory);
  }, []);

  useEffect(() => {
    setLoading(true);
    const handle = window.setTimeout(() => {
      void load(true);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [filterKey]);

  async function load(replace: boolean): Promise<void> {
    if (!replace && loadingMoreRef.current) return;
    const id = ++requestId.current;
    if (replace) {
      loadingMoreRef.current = false;
      setLoading(true);
      cursorRef.current = null;
    } else {
      loadingMoreRef.current = true;
    }
    onError("");
    try {
      const data = await window.api.discover({
        ...filtersRef.current,
        page: 1,
        cursor: cursorRef.current,
      });
      if (id !== requestId.current) return;
      pageRef.current = data.page;
      if (replace || data.totalResults > 0) {
        totalPagesRef.current = Math.max(1, data.totalPages);
        setTotalPages(totalPagesRef.current);
        setTotalResults(data.totalResults);
      } else if (!data.results.length) {
        totalPagesRef.current = pageRef.current;
        setTotalPages(pageRef.current);
      } else {
        totalPagesRef.current = pageRef.current + 1;
        setTotalPages(pageRef.current + 1);
      }
      setPage(data.page);
      cursorRef.current = data.nextCursor;
      lastPageFullRef.current = canLoadMoreFromPage(data.results.length, 40);
      setItems((prev) => {
        if (replace) return data.results;
        return [...prev, ...data.results];
      });
      void applyAgeRatings(id, data.results);
      if (replace) {
        scrollerRef.current?.scrollTo({ top: 0 });
        const first = data.results[0];
        if (first) onOpen(first);
        setEntering(true);
        recordSearchHistory();
      }
    } catch (error) {
      if (id !== requestId.current) return;
      onError(error instanceof Error ? error.message : "Search failed");
    } finally {
      if (id === requestId.current) {
        loadingMoreRef.current = false;
        setLoading(false);
      }
    }
  }

  async function applyAgeRatings(
    request: number,
    movies: MovieSummary[],
  ): Promise<void> {
    const ids = movies.filter((movie) => !movie.certification).map((movie) => movie.imdbId);
    if (!ids.length) return;
    try {
      const rows = await window.api.fillMedia(ids);
      if (request !== requestId.current) return;
      const ratings = new Map(
        rows.map((row) => [row.id, row.certification || undefined]),
      );
      setItems((prev) =>
        prev.map((movie) => {
          const certification = ratings.get(movie.imdbId);
          return certification ? { ...movie, certification } : movie;
        }),
      );
    } catch {
      /* age badges stay empty until the next search */
    }
  }

  function canLoadMore(): boolean {
    return (
      !loadingRef.current &&
      !loadingMoreRef.current &&
      lastPageFullRef.current
    );
  }

  function loadMore(): void {
    if (!canLoadMore()) return;
    void load(false);
  }

  function handleCardOpen(movie: MovieSummary): void {
    onOpen(movie);
  }

  function recordSearchHistory(): void {
    if (historySession.current.saved) return;
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

  const hasResults = items.length > 0;

  useEffect(() => {
    if (layout !== "grid") {
      setGridCols(1);
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    const read = (): void => setGridCols(gridColumnCount(el));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout, items.length, entering]);

  const refreshing = loading && hasResults;
  const countLabel = titleCount(
    totalResults > 0 ? totalResults : items.length,
    loading && !items.length,
  );
  const activeHistoryId =
    history.find((entry) => matchesSearchHistory(filters, entry))?.id ?? null;

  return (
    <section className="grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr_auto] inspect:grid-cols-[280px_minmax(0,1fr)_minmax(280px,400px)] inspect:grid-rows-none">
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        genres={genres}
        profileReady={profileReady}
        history={history}
        activeHistoryId={activeHistoryId}
        onApplyHistory={(entry) =>
          setFilters(applySearchHistory(filters, entry))
        }
        onRemoveHistory={(id) => {
          void removeSearchHistory(id).then(setHistory);
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-col pt-5 pr-0 pb-4 pl-4.5">
        <div className="mb-2 flex items-center justify-between gap-3 pr-4.5">
          <h2 className="m-0 text-[22px] font-650 tracking-title">
            Results
            <span className="ml-2 text-xs font-medium text-muted">
              {countLabel}
            </span>
          </h2>
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
            {loading && !items.length ? (
              <CatalogLoader label="Searching the catalog…" />
            ) : null}
            {!loading && !items.length ? (
              <div className="col-span-full px-4 py-6 text-center text-muted">
                <h3 className="mt-0 mb-2 text-lg tracking-[-0.03em] text-ink">
                  No titles in this slice
                </h3>
                <p>Loosen the vote floor or year window to see more films.</p>
              </div>
            ) : null}
            {hasResults ? (
              <InfiniteScroll
                dataLength={items.length}
                next={loadMore}
                hasMore={canLoadMore()}
                loader={
                  <div className="my-4 mb-2 flex items-center justify-center gap-2.5 text-xs text-muted">
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
                <div
                  className={cn(
                    layout === "grid"
                      ? "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-x-3.5 gap-y-4.5 pr-[var(--rail-gutter,14px)]"
                      : "flex flex-col",
                  )}
                >
                  {items.map((movie, index) => (
                    <MovieCard
                      key={titleKey(movie)}
                      movie={movie}
                      active={selectedId === titleKey(movie)}
                      layout={layout}
                      entering={entering}
                      enterDelay={enterDelayMs(
                        index,
                        layout === "grid" ? gridCols : 1,
                        layout === "grid" ? 36 : 18,
                      )}
                      onOpen={handleCardOpen}
                    />
                  ))}
                </div>
              </InfiniteScroll>
            ) : null}
          </OverlayScroll>
          {refreshing ? (
            <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center bg-canvas/42">
              <CatalogLoader label="Updating results…" />
            </div>
          ) : null}
        </div>
      </div>
      {inspector}
    </section>
  );
}

function titleCount(total: number, searching: boolean): string {
  if (searching && total <= 0) return "Searching…";
  if (total <= 0) return "No titles";
  return `${total.toLocaleString()} titles`;
}
