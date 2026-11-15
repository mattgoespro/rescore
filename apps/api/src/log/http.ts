import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { formatDuration, searchKeyList } from "./format.js";
import { emit, type LineSink } from "./write.js";

export function requestId(): string {
  return randomBytes(2).toString("hex");
}

export function shouldLogRequest(path: string, status: number): boolean {
  if (path === "/health" && status === 200) return false;
  return true;
}

export function shouldLogIncoming(path: string): boolean {
  return path !== "/health";
}

export function httpMessage(input: {
  id: string;
  status: number;
  ms: number;
  path: string;
  query: Record<string, unknown>;
}): string {
  const status = String(input.status).padEnd(6, " ");
  const duration = formatDuration(input.ms);
  const keys = searchKeyList(input.path, input.query);
  const tail = keys ? `  ${keys}` : "";
  return `${input.id}  ${status}${duration}  ${input.path}${tail}`;
}

export function incomingMessage(input: {
  id: string;
  path: string;
  query: Record<string, unknown>;
}): string {
  const mark = "-->".padEnd(6, " ");
  const keys = searchKeyList(input.path, input.query);
  const tail = keys ? `  ${keys}` : "";
  return `${input.id}  ${mark}${input.path}${tail}`;
}

/**
 * Request logging middleware. It takes exactly (req, res, next): Express
 * treats a four-parameter function as an error handler, so the sink and
 * clock that tests pass in live on the factory, not the middleware.
 */
export function createRequestLog(
  sink?: LineSink,
  now: () => number = Date.now,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => logRequest(req, res, next, sink, now());
}

export const requestLog = createRequestLog();

function logRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  sink: LineSink | undefined,
  startedAt: number,
): void {
  const id = requestId();
  res.locals.requestId = id;
  const query = req.query as Record<string, unknown>;
  // A mounted router trims its prefix from req.path before the response
  // finishes, so /v1/titles would finish as /titles.
  const path = req.path;
  if (shouldLogIncoming(path)) {
    emit(
      {
        channel: "http",
        phase: req.method,
        level: "info",
        message: incomingMessage({ id, path, query }),
      },
      sink,
    );
  }
  res.on("finish", () => {
    const status = res.statusCode;
    if (!shouldLogRequest(path, status)) return;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    emit(
      {
        channel: "http",
        phase: req.method,
        level,
        message: httpMessage({
          id,
          status,
          ms: Date.now() - startedAt,
          path,
          query,
        }),
      },
      sink,
    );
  });
  next();
}
