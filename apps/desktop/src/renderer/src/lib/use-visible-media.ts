import { useEffect, useRef, useState } from "react";

export type TitleMedia = Awaited<
  ReturnType<Window["api"]["fillMedia"]>
>[number];

export function mergeTitleMedia<
  T extends {
    imdbId: string;
    posterPath?: string | null;
    overview?: string;
    certification?: string;
  },
>(title: T, media: ReadonlyMap<string, TitleMedia>): T {
  const row = media.get(title.imdbId);
  return row
    ? {
        ...title,
        posterPath: row.posterUrl ?? title.posterPath,
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
      const ids = [...visible]
        .filter(
          (id) => !resolved.has(id) && (retryAt.get(id) ?? 0) <= Date.now(),
        )
        .slice(0, 40);
      if (!ids.length) return;
      busy = true;
      for (const id of ids) retryAt.set(id, Date.now() + 30_000);
      try {
        const rows = await window.api.fillMedia(ids);
        if (disposed) return;
        for (const row of rows) if (row.hydrationComplete) resolved.add(row.id);
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
      for (const id of status.tmdbHydration?.completedIds ?? []) {
        if (!resolved.has(id)) retryAt.delete(id);
      }
      void fill();
    });
    const timer = window.setInterval(() => void fill(), 30_000);
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
