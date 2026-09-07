import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { SYNC_INTERVAL_MS } from "../config.js";

const PROGRESS_INTERVAL_MS = 200;
const MIN_GZIP_BYTES = 64;

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

interface RemoteProbe {
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
}

interface FileMeta extends RemoteProbe {
  size: number;
}

export function isStale(file: string, maxAgeMs = SYNC_INTERVAL_MS): boolean {
  return Date.now() - statSync(file).mtimeMs >= maxAgeMs;
}

export function cleanupIncompleteDownloads(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".tmp")) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      /* ignore leftover temp files */
    }
  }
}

export async function ensureGzipFile(
  url: string,
  file: string,
  force = false,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  mkdirSync(dirname(file), { recursive: true });
  const probe = await probeRemote(url);
  if (!force && canReuseLocalFile(file, probe)) {
    if (!readMeta(file) && (probe.etag || probe.lastModified || probe.contentLength)) {
      writeMeta(file, {
        etag: probe.etag,
        lastModified: probe.lastModified,
        contentLength: probe.contentLength ?? statSync(file).size,
        size: statSync(file).size,
      });
    }
    console.log(`[catalog] Reusing ${file}`);
    return file;
  }
  console.log(`[catalog] Downloading ${url}`);
  await downloadGzip(url, file, onProgress, probe);
  if (!isValidGzipFile(file)) {
    await unlink(file).catch(() => undefined);
    throw new Error(`Downloaded file failed validation: ${file}`);
  }
  writeMeta(file, {
    etag: probe.etag,
    lastModified: probe.lastModified,
    contentLength: probe.contentLength ?? statSync(file).size,
    size: statSync(file).size,
  });
  return file;
}

export async function downloadGzip(
  url: string,
  file: string,
  onProgress?: (progress: DownloadProgress) => void,
  probe?: RemoteProbe,
): Promise<void> {
  const headers: Record<string, string> = { Accept: "application/gzip" };
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }

  const tmp = `${file}.${process.pid}.tmp`;
  const length = Number(response.headers.get("content-length"));
  const totalBytes =
    Number.isFinite(length) && length > 0
      ? length
      : probe?.contentLength && probe.contentLength > 0
        ? probe.contentLength
        : null;
  let receivedBytes = 0;
  let lastEmit = 0;
  const emit = (forceEmit = false): void => {
    const now = Date.now();
    if (!forceEmit && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    onProgress?.({ receivedBytes, totalBytes });
  };
  emit(true);

  try {
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length;
        emit();
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      counter,
      createWriteStream(tmp),
    );
    emit(true);
    if (totalBytes != null && receivedBytes !== totalBytes) {
      throw new Error(
        `Incomplete download of ${file} (${receivedBytes} of ${totalBytes} bytes)`,
      );
    }
    await rename(tmp, file);
  } catch (error) {
    if (existsSync(tmp)) await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function* readTsvRows(file: string): AsyncGenerator<string[]> {
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    if (!line) continue;
    yield line.split("\t");
  }
}

export function imdbValue(value: string | undefined): string | null {
  if (value == null || value === "" || value === "\\N") return null;
  return value;
}

function canReuseLocalFile(file: string, probe: RemoteProbe): boolean {
  if (!existsSync(file) || !isValidGzipFile(file)) return false;
  const size = statSync(file).size;
  const meta = readMeta(file);
  if (probe.etag && meta?.etag) return probe.etag === meta.etag;
  if (probe.lastModified && meta?.lastModified) {
    return probe.lastModified === meta.lastModified;
  }
  if (probe.contentLength) return size === probe.contentLength;
  return true;
}

function isValidGzipFile(file: string): boolean {
  let fd: number | undefined;
  try {
    const size = statSync(file).size;
    if (size < MIN_GZIP_BYTES) return false;
    fd = openSync(file, "r");
    const bytes = Buffer.alloc(2);
    if (readSync(fd, bytes, 0, 2, 0) < 2) return false;
    return bytes[0] === 0x1f && bytes[1] === 0x8b;
  } catch {
    return false;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function metaPath(file: string): string {
  return `${file}.meta.json`;
}

function readMeta(file: string): FileMeta | null {
  try {
    const raw = JSON.parse(readFileSync(metaPath(file), "utf8")) as Partial<FileMeta>;
    return {
      etag: typeof raw.etag === "string" ? raw.etag : null,
      lastModified: typeof raw.lastModified === "string" ? raw.lastModified : null,
      contentLength:
        typeof raw.contentLength === "number" && raw.contentLength > 0
          ? raw.contentLength
          : null,
      size: typeof raw.size === "number" && raw.size > 0 ? raw.size : 0,
    };
  } catch {
    return null;
  }
}

function writeMeta(file: string, meta: FileMeta): void {
  writeFileSync(metaPath(file), JSON.stringify(meta), "utf8");
}

async function probeRemote(url: string): Promise<RemoteProbe> {
  const empty: RemoteProbe = { etag: null, lastModified: null, contentLength: null };
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { Accept: "application/gzip" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return empty;
    return headersToProbe(response);
  } catch {
    return empty;
  }
}

function headersToProbe(response: Response): RemoteProbe {
  const length = Number(response.headers.get("content-length"));
  return {
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentLength: Number.isFinite(length) && length > 0 ? length : null,
  };
}
