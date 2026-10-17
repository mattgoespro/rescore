import { useEffect, useRef, useState } from "react";

export const MEDIA_FILL_LIMIT = 40;
export const MEDIA_RETRY_MS = 30_000;

export function mediaIdsToFill(input: {
  ids: Iterable<string>;
  resolved: ReadonlySet<string>;
  retryAt: ReadonlyMap<string, number>;
  now: number;
  limit?: number;
}): string[] {
  const limit = input.limit ?? MEDIA_FILL_LIMIT;
  const ids: string[] = [];
  for (const id of input.ids) {
    if (ids.length >= limit) break;
    if (input.resolved.has(id)) continue;
    if ((input.retryAt.get(id) ?? 0) > input.now) continue;
    ids.push(id);
  }
  return ids;
}

export function mediaFillSettled(
  row: { hydrationComplete?: boolean } | undefined,
): boolean {
  return row?.hydrationComplete === true;
}

export function clearPendingRetries(
  retryAt: Map<string, number>,
  completedIds: readonly string[],
  resolved: ReadonlySet<string>,
): void {
  for (const id of completedIds) {
    if (!resolved.has(id)) retryAt.delete(id);
  }
}

export function invalidateCompletedMedia(
  retryAt: Map<string, number>,
  resolved: Set<string>,
  completedIds: readonly string[],
): void {
  for (const id of completedIds) {
    resolved.delete(id);
    retryAt.delete(id);
  }
}

export type TitleMedia = Awaited<
  ReturnType<Window["api"]["fillMedia"]>
>[number];

export function mergeTitleMedia<
  T extends {
    imdbId: string;
    posterPath?: string | null;
    posterStatus?: "pending" | "available" | "unavailable";
    overview?: string;
    certification?: string;
  },
>(title: T, media: ReadonlyMap<string, TitleMedia>): T {
  const row = media.get(title.imdbId);
  return row
    ? {
        ...title,
        posterPath: row.posterUrl ?? title.posterPath,
        posterStatus: row.posterUrl
          ? "available"
          : row.posterUrl === ""
            ? "unavailable"
            : (title.posterStatus ?? "pending"),
        overview: row.synopsis ?? title.overview,
        certification: row.certification ?? title.certification,
      }
    : title;
}

/** Only visible rows request metadata. Results never replace the list or its cursor. */
export function useVisibleMedia() {
  const containerRef = useRef<HTMLElement | null>(null);
  const [media, setMedia] = useState<ReadonlyMap<string, TitleMedia>>(
    new Map(),
  );
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let busy = false;
    const visible = new Set<string>();
    const resolved = new Set<string>();
    const retryAt = new Map<string, number>();
    const observed = new Set<Element>();
    async function fill(): Promise<void> {
      if (disposed || busy) return;
      const ids = mediaIdsToFill({
        ids: visible,
        resolved,
        retryAt,
        now: Date.now(),
      });
      if (!ids.length) return;
      busy = true;
      for (const id of ids) retryAt.set(id, Date.now() + MEDIA_RETRY_MS);
      try {
        const rows = await window.api.fillMedia(ids);
        if (disposed) return;
        for (const row of rows) if (mediaFillSettled(row)) resolved.add(row.id);
        setMedia((current) => {
          const next = new Map(current);
          for (const row of rows) next.set(row.id, row);
          return next;
        });
      } catch {
        /* Keep available data; retry visible failures after backoff. */
      } finally {
        busy = false;
        if (!disposed) void fill();
      }
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-imdb-id");
        if (!id) continue;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      void fill();
    });
    const scan = (): void => {
      for (const element of observed) {
        if (!container!.contains(element)) {
          visible.delete(element.getAttribute("data-imdb-id") ?? "");
          observer.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of container!.querySelectorAll("[data-imdb-id]")) {
        if (!observed.has(element)) {
          observed.add(element);
          observer.observe(element);
        }
      }
    };
    const mutations = new MutationObserver(scan);
    mutations.observe(container, { childList: true, subtree: true });
    scan();
    const unsubscribe = window.api.onCatalogStatus((status) => {
      invalidateCompletedMedia(
        retryAt,
        resolved,
        status.tmdbHydration?.completedIds ?? [],
      );
      void fill();
    });
    const timer = window.setInterval(() => void fill(), MEDIA_RETRY_MS);
    return () => {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);
  return { containerRef, media };
}
