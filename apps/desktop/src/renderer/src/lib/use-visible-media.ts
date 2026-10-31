import { useEffect, useRef, useState } from "react";
import { pollWhileVisible } from "./poll-while-visible";

export const MEDIA_FILL_LIMIT = 40;
export const MEDIA_RETRY_MS = 30_000;
/** Media rows kept for titles scrolled past; the oldest give way first. */
export const MEDIA_CACHE_LIMIT = 800;

function sameRow(a: object, b: object): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        (a as Record<string, unknown>)[key] ===
        (b as Record<string, unknown>)[key],
    )
  );
}

/**
 * Adds rows to a media map, dropping the oldest beyond the limit. Rows that
 * change nothing, such as titles still waiting on TMDb, keep the same map so
 * the list does not redraw.
 */
export function mergeMediaRows<T extends { id: string }>(
  current: ReadonlyMap<string, T>,
  rows: readonly T[],
  limit = MEDIA_CACHE_LIMIT,
): ReadonlyMap<string, T> {
  if (
    rows.every((row) => {
      const known = current.get(row.id);
      return known !== undefined && sameRow(known, row);
    })
  )
    return current;
  const next = new Map(current);
  for (const row of rows) {
    next.delete(row.id);
    next.set(row.id, row);
  }
  for (const key of next.keys()) {
    if (next.size <= limit) break;
    next.delete(key);
  }
  return next;
}

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
      const now = Date.now();
      // Spent backoffs for titles scrolled away would otherwise pile up.
      for (const [id, at] of retryAt) if (at <= now) retryAt.delete(id);
      const ids = mediaIdsToFill({ ids: visible, resolved, retryAt, now });
      if (!ids.length) return;
      busy = true;
      for (const id of ids) retryAt.set(id, Date.now() + MEDIA_RETRY_MS);
      try {
        const rows = await window.api.fillMedia(ids);
        if (disposed) return;
        for (const row of rows) {
          if (!mediaFillSettled(row)) continue;
          resolved.add(row.id);
          retryAt.delete(row.id);
        }
        setMedia((current) => {
          const next = mergeMediaRows(current, rows);
          // A row the cache dropped is no longer resolved: scrolling back to
          // that title asks again instead of showing its search-time poster.
          for (const id of resolved) if (!next.has(id)) resolved.delete(id);
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
    // Scrolling a virtual list mutates the DOM many times a frame; one scan
    // per frame sees the same rows.
    let frame = 0;
    const scheduleScan = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!disposed) scan();
      });
    };
    const mutations = new MutationObserver(scheduleScan);
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
    const stopPolling = pollWhileVisible(() => void fill(), MEDIA_RETRY_MS);
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      unsubscribe();
      stopPolling();
    };
  }, []);
  return { containerRef, media };
}
