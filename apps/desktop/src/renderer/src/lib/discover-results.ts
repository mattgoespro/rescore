import type {
  DiscoverFilters,
  LibraryEntry,
  PagedMovies,
  RankedMovie,
} from "../../../shared/types";
import { titleKey } from "../../../shared/movie";

export function createDiscoverResults(
  request: (filters: DiscoverFilters) => Promise<PagedMovies>,
) {
  let snapshot = {
    items: [] as RankedMovie[],
    totalResults: null as number | null,
    loading: true,
    loadingMore: false,
    canLoadMore: false,
    error: "",
    completion: null as { id: number; reset: boolean } | null,
  };
  let filters: DiscoverFilters;
  let cursor: string | null = null;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(change: Partial<typeof snapshot>): void {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  }
  function cancel(): void {
    generation++;
  }
  function configure(next: DiscoverFilters): void {
    disposed = false;
    filters = next;
    cancel();
    cursor = null;
    publish({ loading: true, loadingMore: false, canLoadMore: false });
  }
  async function load(replace: boolean, preserve = false): Promise<void> {
    if (
      disposed ||
      (!replace &&
        (snapshot.loading || snapshot.loadingMore || !snapshot.canLoadMore))
    )
      return;
    const id = ++generation;
    const target = snapshot.items.length;
    const capturedFilters = { ...filters, page: 1 };
    if (replace) cursor = null;
    publish({
      loading: replace ? true : snapshot.loading,
      loadingMore: !replace,
      error: "",
    });
    try {
      let data = await request({ ...capturedFilters, cursor });
      if (disposed || id !== generation) return;
      const fresh = [...data.results];
      while (
        preserve &&
        fresh.length < target &&
        data.canLoadMore &&
        data.nextCursor
      ) {
        data = await request({ ...capturedFilters, cursor: data.nextCursor });
        if (disposed || id !== generation) return;
        fresh.push(...data.results);
      }
      cursor = data.nextCursor;
      publish({
        items: replace ? fresh : [...snapshot.items, ...data.results],
        totalResults: data.totalResults,
        canLoadMore: data.canLoadMore,
        completion: { id, reset: replace && !preserve },
      });
    } catch (error) {
      if (!disposed && id === generation)
        publish({
          error: error instanceof Error ? error.message : "Search failed",
        });
    } finally {
      if (!disposed && id === generation)
        publish({ loading: false, loadingMore: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    configure,
    cancel,
    replace: () => load(true),
    refresh: () => load(true, true),
    loadMore: () => load(false),
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}

export function visibleDiscoverItems(
  items: RankedMovie[],
  library: LibraryEntry[],
  filters: DiscoverFilters,
): RankedMovie[] {
  const statuses = new Map(
    library.map((entry) => [titleKey(entry), entry.status]),
  );
  return items.filter((movie) => {
    const status = statuses.get(titleKey(movie));
    return (
      status !== "skipped" &&
      !(filters.hideWatched && status === "watched") &&
      !(filters.hideWatchlist && status === "watchlist")
    );
  });
}
