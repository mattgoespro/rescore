export type ServiceLogLevel = "debug" | "info" | "warn" | "error";

/** One catalogue API log line, split into the columns `formatLine` writes. */
export interface ServiceLogLine {
  time: string;
  channel: string;
  phase: string;
  level: ServiceLogLevel;
  message: string;
}

export interface ServiceLogRead {
  /**
   * The Windows service's log file, the API this session started, or nothing
   * Rescore can read (an API it did not start).
   */
  source: "service" | "session" | "none";
  /** These lines replace any read before: a first read, or too far behind. */
  reset: boolean;
  lines: ServiceLogLine[];
  /** Pass back on the next read to get only newer lines. */
  cursor: string | null;
  /** Part of the log could not be read; these lines are still good. */
  warning?: string;
}

/** Lines the log view keeps; older ones drop off the top. */
export const SERVICE_LOG_LINE_LIMIT = 2_000;

/**
 * Adds newly read lines after those already shown, keeping the newest
 * `limit`. A read can begin with stack frames whose line came in the read
 * before (no time or channel); they join that line and keep its level.
 */
export function appendLogLines<T extends ServiceLogLine>(
  current: readonly T[],
  fresh: readonly T[],
  limit = SERVICE_LOG_LINE_LIMIT,
): T[] {
  const lines = [...current];
  const last = lines.at(-1);
  let start = 0;
  if (last) {
    let message = last.message;
    while (start < fresh.length && !fresh[start].time && !fresh[start].channel)
      message += `\n${fresh[start++].message}`;
    if (start > 0) lines[lines.length - 1] = { ...last, message };
  }
  lines.push(...fresh.slice(start));
  return lines.slice(-limit);
}
