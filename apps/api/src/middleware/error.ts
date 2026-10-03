import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { emit } from "../log/write.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ error: "Invalid request", details: error.flatten() });
    return;
  }

  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
  const message =
    status === 500
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : "Request failed";
  if (status === 500) {
    const id =
      typeof res.locals.requestId === "string" ? res.locals.requestId : "----";
    const detail = error instanceof Error ? error.message : String(error);
    const stack =
      process.env.LOG_LEVEL === "debug" && error instanceof Error && error.stack
        ? ` ${error.stack}`
        : "";
    emit({
      channel: "http",
      phase: "error",
      level: "error",
      message: `${id}  ${detail}${stack}`,
    });
  }
  res.status(status).json({ error: message });
};
