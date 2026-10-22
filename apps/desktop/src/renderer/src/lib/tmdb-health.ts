export type TmdbHealthReading = {
  total: number;
  posters: number;
  synopses: number;
  certifications: number;
};

let last: TmdbHealthReading | undefined;
let inflight: Promise<TmdbHealthReading | null> | null = null;

/** The most recent coverage reading this session, if there is one. */
export function lastTmdbHealth(): TmdbHealthReading | undefined {
  return last;
}

/**
 * Reads TMDb coverage and remembers it, so Settings can open with the bars
 * already at their real values. Concurrent callers share one request.
 */
export function loadTmdbHealth(): Promise<TmdbHealthReading | null> {
  inflight ??= Promise.resolve()
    .then(() => window.api.tmdbHealth())
    .then((next) => {
      if (next) last = next;
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
