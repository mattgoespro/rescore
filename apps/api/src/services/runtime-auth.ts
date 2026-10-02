import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function runtimeAuth(token: string): RequestHandler {
  return (req, res, next) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      !token ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
