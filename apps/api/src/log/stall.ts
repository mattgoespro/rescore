import { statSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";
import { formatDuration } from "./format.js";
import { emit } from "./write.js";

/** How often the watch checks that the thread is free. */
export const STALL_CHECK_MS = 250;
/** A block this long is logged: requests waited this long for an answer. */
export const STALL_REPORT_MS = 1000;
/** A single catalogue call or GC pause this long is named in the log. */
export const SLOW_CALL_MS = 250;

/**
 * Returns a tick that reports when it runs later than expected. The API runs
 * SQLite on its only thread, so a slow statement holds every request; the
 * desktop then times out with nothing in the log to say why.
 */
export function createStallWatch(
  report: (blockedMs: number) => void,
  now: () => number = Date.now,
  intervalMs = STALL_CHECK_MS,
  thresholdMs = STALL_REPORT_MS,
): () => void {
  let expected = now() + intervalMs;
  return () => {
    const at = now();
    const late = at - expected;
    if (late >= thresholdMs) report(late);
    expected = at + intervalMs;
  };
}

/**
 * Wraps every method of `target` so a call that holds the thread for
 * `thresholdMs` or more is reported by name. Only the outermost call is
 * reported, so a method calling another one is one line, not two.
 */
export function timeSlowCalls<T extends object>(
  target: T,
  report: (method: string, ms: number) => void,
  now: () => number = () => performance.now(),
  thresholdMs = SLOW_CALL_MS,
): T {
  let depth = 0;
  return new Proxy(target, {
    get(object, key, receiver) {
      const value: unknown = Reflect.get(object, key, receiver);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return function (this: unknown, ...args: unknown[]) {
        const started = now();
        depth++;
        try {
          return (value as (...args: unknown[]) => unknown).apply(this, args);
        } finally {
          depth--;
          const ms = now() - started;
          if (depth === 0 && ms >= thresholdMs) report(key, ms);
        }
      };
    },
  });
}

/** Logs a catalogue call that held the API thread. */
export function reportSlowCatalogCall(method: string, ms: number): void {
  emit({
    channel: "api",
    phase: "stall",
    level: "warn",
    message: `Catalogue ${method}() held the API thread for ${formatDuration(ms)}`,
  });
}

function walSize(databasePath: string): string {
  try {
    const bytes = statSync(`${databasePath}-wal`).size;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    return "none";
  }
}

/**
 * Logs each time the API thread is blocked for a second or more, with the
 * size of the catalogue's write-ahead log, and each garbage collection pause
 * long enough to be one of the causes.
 */
export function watchEventLoopStalls(databasePath: string): () => void {
  const tick = createStallWatch((blockedMs) => {
    emit({
      channel: "api",
      phase: "stall",
      level: "warn",
      message: `API thread blocked for ${formatDuration(blockedMs)}; requests waited until it was free (WAL ${walSize(databasePath)})`,
    });
  });
  const timer = setInterval(tick, STALL_CHECK_MS);
  timer.unref();
  const gc = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < SLOW_CALL_MS) continue;
      emit({
        channel: "api",
        phase: "stall",
        level: "warn",
        message: `Garbage collection paused the API thread for ${formatDuration(entry.duration)}`,
      });
    }
  });
  gc.observe({ entryTypes: ["gc"] });
  return () => {
    clearInterval(timer);
    gc.disconnect();
  };
}
