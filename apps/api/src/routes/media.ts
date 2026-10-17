import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import { POSTER_CACHE_DIR } from "../config.js";

const ALLOWED_HOSTS = new Set([
  "image.tmdb.org",
  "media.themoviedb.org",
  "www.themoviedb.org",
]);
interface CachedImage {
  type: string;
  size: number;
}
const downloads = new Map<string, Promise<CachedImage | null>>();

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
    let image = await readCachedImage(cached.file);
    if (!image) {
      let pending = downloads.get(cached.file);
      if (!pending) {
        pending = downloadImage(url, cached);
        downloads.set(cached.file, pending);
      }
      try {
        image = await pending;
      } finally {
        if (downloads.get(cached.file) === pending)
          downloads.delete(cached.file);
      }
    }
    if (!image) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", image.type);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    createReadStream(cached.file)
      .on("error", (error) => {
        if (res.headersSent) res.destroy(error);
        else next(error);
      })
      .pipe(res);
  } catch (error) {
    next(error);
  }
};

async function readCachedImage(file: string): Promise<CachedImage | null> {
  try {
    const metadata = JSON.parse(
      await readFile(`${file}.complete`, "utf8"),
    ) as CachedImage;
    return metadata.type?.startsWith("image/") &&
      metadata.size > 0 &&
      (await stat(file)).size === metadata.size
      ? metadata
      : null;
  } catch {
    return null;
  }
}

async function downloadImage(
  url: URL,
  cached: { file: string; dir: string },
): Promise<CachedImage | null> {
  const temporary = `${cached.file}.${randomUUID()}.tmp`;
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status === 404) return null;
    if (!upstream.ok || !upstream.body)
      throw new Error(`Media download failed (${upstream.status})`);
    const type = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) {
      throw new Error("Media response was not an image");
    }
    mkdirSync(cached.dir, { recursive: true });
    await pipeline(
      Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      ),
      createWriteStream(temporary, { flags: "wx" }),
    );
    const size = (await stat(temporary)).size;
    const expected = Number(upstream.headers.get("content-length"));
    if (
      !size ||
      (!upstream.headers.get("content-encoding") &&
        expected > 0 &&
        size !== expected)
    ) {
      throw new Error("Incomplete media download");
    }
    await rename(temporary, cached.file);
    const metadata = { type, size };
    await writeFile(`${cached.file}.complete`, JSON.stringify(metadata));
    return metadata;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw Object.assign(
      error instanceof Error ? error : new Error("Media download failed"),
      { status: 502 },
    );
  }
}

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
