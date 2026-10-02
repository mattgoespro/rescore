import { Router, type Response } from "express";
import {
  readTmdbHydration,
  subscribeTmdbHydration,
} from "../services/ensure-catalog.js";
import type { TmdbHydrationProgress } from "../types.js";

const HEARTBEAT_MS = 15_000;
const streams = new Set<Response>();

export function createHydrationEventsRouter(): Router {
  const router = Router();
  router.get("/events", (_req, res) => {
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    streams.add(res);
    writeHydrationEvent(res, readTmdbHydration());
    const unsubscribe = subscribeTmdbHydration((progress) => {
      writeHydrationEvent(res, progress);
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    heartbeat.unref();
    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  });
  return router;
}

export function closeHydrationEventStreams(): void {
  for (const stream of streams) stream.end();
  streams.clear();
}

function writeHydrationEvent(
  res: Response,
  progress: TmdbHydrationProgress,
): void {
  if (res.writableEnded) return;
  res.write(`event: hydration\ndata: ${JSON.stringify(progress)}\n\n`);
}
