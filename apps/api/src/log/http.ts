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

export function requestLog(
  req: Request,
  res: Response,
  next: NextFunction,
  sink?: LineSink,
  startedAt = Date.now(),
): void {
  const id = requestId();
  res.locals.requestId = id;
  res.on("finish", () => {
    const status = res.statusCode;
    if (!shouldLogRequest(req.path, status)) return;
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
          path: req.path,
          query: req.query as Record<string, unknown>,
        }),
      },
      sink,
    );
  });
  next();
}
