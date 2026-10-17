import type {
  ForYouResult,
  LibraryEntry,
  RankedMovie,
} from "../../../shared/types";
import { titleKey } from "../../../shared/movie";

export function createForYouResults(request: () => Promise<ForYouResult>) {
  let snapshot = {
    result: null as ForYouResult | null,
    loading: true,
    error: "",
    completion: 0,
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (change: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };
  async function refresh(): Promise<void> {
    const id = ++generation;
    publish({ loading: true, error: "" });
    try {
      const result = await request();
      if (id === generation) publish({ result, completion: id });
    } catch (error) {
      if (id === generation)
        publish({
          error:
            error instanceof Error ? error.message : "Could not build rankings",
        });
    } finally {
      if (id === generation) publish({ loading: false });
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
    refresh,
    dispose: () => {
      generation++;
    },
  };
}

export function visibleForYouItems(
  items: RankedMovie[],
  library: LibraryEntry[],
): RankedMovie[] {
  const excluded = new Set(
    library
      .filter(
        (entry) => entry.status === "watched" || entry.status === "skipped",
      )
      .map(titleKey),
  );
  return items.filter((movie) => !excluded.has(titleKey(movie)));
}
