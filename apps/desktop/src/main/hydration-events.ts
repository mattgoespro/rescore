import type { TmdbHydrationProgress } from "../shared/types";

export interface HydrationEventParser {
  push(chunk: string): TmdbHydrationProgress[];
}

export function hydrationEventsUrl(baseUrl: string): URL {
  return new URL("/v1/catalog/hydration/events", `${baseUrl}/`);
}

export function createHydrationEventParser(): HydrationEventParser {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.replace(/\r\n/g, "\n");
      const events = pending.split("\n\n");
      pending = events.pop() ?? "";
      return events
        .map(parseHydrationEvent)
        .filter((event): event is TmdbHydrationProgress => event != null);
    },
  };
}

function parseHydrationEvent(frame: string): TmdbHydrationProgress | null {
  let eventName = "";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (eventName !== "hydration" || data.length === 0) return null;
  try {
    return toHydrationProgress(JSON.parse(data.join("\n")));
  } catch {
    return null;
  }
}

function toHydrationProgress(value: unknown): TmdbHydrationProgress | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const processed = numberValue(input.processed);
  const total = numberValue(input.total);
  const percent = numberValue(input.percent);
  if (
    processed == null ||
    total == null ||
    percent == null ||
    typeof input.complete !== "boolean" ||
    typeof input.message !== "string"
  ) {
    return null;
  }
  return {
    ...(Array.isArray(input.completedIds) ? { completedIds: input.completedIds.filter((id): id is string => typeof id === "string" && /^tt\d+$/.test(id)).slice(0, 400) } : {}),
    processed,
    total,
    percent: Math.min(100, percent),
    complete: input.complete,
    message: input.message,
  };
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}
