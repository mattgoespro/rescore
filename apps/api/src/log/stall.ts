import { formatDuration } from "./format.js";
import { emit } from "./write.js";

/** How often the watch checks that the thread is free. */
export const STALL_CHECK_MS = 250;
/** A block this long is logged: requests waited this long for an answer. */
export const STALL_REPORT_MS = 1000;

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

/** Logs each time the API thread is blocked for a second or more. */
export function watchEventLoopStalls(): () => void {
  const tick = createStallWatch((blockedMs) => {
    emit({
      channel: "api",
      phase: "stall",
      level: "warn",
      message: `API thread blocked for ${formatDuration(blockedMs)}; requests waited until it was free`,
    });
  });
  const timer = setInterval(tick, STALL_CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
