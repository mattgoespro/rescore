import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RequestHandler } from "express";
import { POSTER_CACHE_DIR } from "../config.js";

const ALLOWED_HOSTS = new Set([
  "image.tmdb.org",
  "media.themoviedb.org",
  "www.themoviedb.org",
]);

export const mediaHandler: RequestHandler = async (req, res, next) => {
  try {
    const raw = typeof req.query.src === "string" ? req.query.src : "";
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      res.status(400).json({ error: "Invalid media URL" });
      return;
    }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
      res.status(400).json({ error: "Unsupported media host" });
      return;
    }

    const cached = cachePath(url);
    if (existsSync(cached.file)) {
      res.setHeader("Content-Type", contentTypeFor(cached.file));
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.send(readFileSync(cached.file));
      return;
    }

    const upstream = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status === 404 ? 404 : 502).end();
      return;
    }
    const type = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) {
      res.status(502).end();
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    mkdirSync(cached.dir, { recursive: true });
    writeFileSync(cached.file, buffer);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

function cachePath(url: URL): { file: string; dir: string } {
  const size = url.pathname.match(/\/t\/p\/([^/]+)/)?.[1] ?? "original";
  const hash = createHash("sha1").update(url.href).digest("hex");
  const ext = extensionFor(url.pathname);
  const dir = join(POSTER_CACHE_DIR, size);
  return { file: join(dir, `${hash}${ext}`), dir };
}

function extensionFor(pathname: string): string {
  const match = pathname.match(/\.(jpg|jpeg|png|webp|avif)$/i);
  return match ? `.${match[1]!.toLowerCase()}` : ".jpg";
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}
