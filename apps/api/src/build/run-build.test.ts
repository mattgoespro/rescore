import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, test } from "node:test";
import type { CatalogDatabase } from "../catalog/index.js";

// `../config.js` reads IMDB_DATA_DIR the first time it is imported by this
// process, so every module that transitively touches it must be loaded
// dynamically, after the env var below is set. (`import type` above is
// erased at compile time and never triggers a real module load.) This is
// what keeps these tests from ever touching a real IMDb dump cache on disk.
const dataDir = mkdtempSync(join(tmpdir(), "rescore-dumps-"));
process.env.IMDB_DATA_DIR = dataDir;

const { buildCatalogTitles } = await import("./run-build.js");
const { titleDumpUrls } = await import("./download-dumps.js");
const { DATASET_FILE } = await import("../config.js");
const { CatalogDatabase: CatalogDatabaseCtor } = await import(
  "../catalog/index.js"
);

const BASICS_FILE = "title.basics.tsv.gz";
const urls = titleDumpUrls();
const ratingsPath = join(dataDir, DATASET_FILE);
const basicsPath = join(dataDir, BASICS_FILE);

const RATINGS_HEADER = "tconst\taverageRating\tnumVotes";
const BASICS_HEADER =
  "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres";

function gzipTsv(lines: string[]): Buffer {
  // Pad so tiny fixtures still clear ensureGzipFile's MIN_GZIP_BYTES
  // validity floor after compression.
  const padding = `#${"padding-so-the-gzip-stream-clears-the-minimum-size-check-".repeat(2)}\n`;
  return gzipSync(Buffer.from(`${lines.join("\n")}\n${padding}`));
}

function seedLocalDump(
  path: string,
  meta: { etag?: string | null; lastModified?: string | null },
  lines: string[],
): void {
  const body = gzipTsv(lines);
  writeFileSync(path, body);
  writeFileSync(
    `${path}.meta.json`,
    JSON.stringify({
      etag: meta.etag ?? null,
      lastModified: meta.lastModified ?? null,
      contentLength: body.length,
      size: body.length,
    }),
    "utf8",
  );
}

function resetDumpFiles(): void {
  for (const path of [
    ratingsPath,
    basicsPath,
    `${ratingsPath}.meta.json`,
    `${basicsPath}.meta.json`,
  ]) {
    rmSync(path, { force: true });
  }
}

const catalogDirs: string[] = [];
function openCatalog(): CatalogDatabase {
  const dir = mkdtempSync(join(tmpdir(), "rescore-run-build-"));
  catalogDirs.push(dir);
  return new CatalogDatabaseCtor(join(dir, "catalog.sqlite"));
}

function seedUsableCatalog(
  catalog: CatalogDatabase,
  options: { id: string; fingerprint: string },
): void {
  catalog.insertTitleRows([
    {
      id: options.id,
      title: "Existing Title",
      originalTitle: "Existing Title",
      kind: "movie",
      year: 1999,
      runtimeMinutes: 100,
      imdbRating: 8,
      imdbVotes: 1000,
      genres: ["Drama"],
    },
  ]);
  catalog.setCatalogMeta({
    builtAt: new Date().toISOString(),
    revision: "test",
    source: "test",
  });
  catalog.setTitleDumpFingerprint(options.fingerprint);
}

type ProbeResult = { etag?: string | null; lastModified?: string | null } | null;

interface FetchHandlers {
  head: (url: string) => ProbeResult;
  get?: (url: string) => Buffer;
}

let originalFetch: typeof fetch | undefined;

function installFetch(handlers: FetchHandlers): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: unknown,
    init?: { method?: string },
  ): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      const result = handlers.head(url);
      if (!result) return new Response(null, { status: 500 });
      const headers = new Headers();
      if (result.etag) headers.set("etag", result.etag);
      if (result.lastModified) headers.set("last-modified", result.lastModified);
      return new Response(null, { status: 200, headers });
    }
    if (!handlers.get) {
      throw new Error(`Unexpected download request (no GET handler installed): ${url}`);
    }
    const body = handlers.get(url);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "content-length": String(body.length) },
    });
  }) as typeof fetch;
}

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
  resetDumpFiles();
  while (catalogDirs.length) {
    const dir = catalogDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("partial probe failure does not set titlesUpdateAvailable", async () => {
  const catalog = openCatalog();
  seedLocalDump(ratingsPath, { etag: "etag-r1" }, [
    RATINGS_HEADER,
    "tt0000001\t8.0\t1000",
  ]);
  seedLocalDump(basicsPath, { etag: "etag-b1" }, [
    BASICS_HEADER,
    "tt0000001\tmovie\tExisting Title\tExisting Title\t0\t1999\t\\N\t100\tDrama",
  ]);
  seedUsableCatalog(catalog, { id: "tt0000001", fingerprint: "etag-r1\netag-b1" });

  installFetch({
    head: (url) => {
      if (url === urls.ratings) return { etag: "etag-r1" };
      if (url === urls.basics) return null; // simulated failed HEAD probe
      return null;
    },
    // no GET handler: reusing the cached files must be enough, or this throws
  });

  const result = await buildCatalogTitles(catalog, {});

  assert.equal(
    catalog.titlesUpdateAvailable(),
    false,
    "a partial probe failure must never look like a confirmed remote change",
  );
  assert.equal(result.unchanged, true);
  assert.equal(catalog.titleCount(), 1);
  catalog.close();
});

test("a confirmed remote change does not download or parse", async () => {
  const catalog = openCatalog();
  seedUsableCatalog(catalog, {
    id: "tt0000001",
    fingerprint: "old-etag-r\nold-etag-b",
  });

  installFetch({
    head: (url) => {
      if (url === urls.ratings) return { etag: "new-etag-r" };
      if (url === urls.basics) return { etag: "old-etag-b" };
      return null;
    },
    // no GET handler: any download attempt here is the bug under test
  });

  const result = await buildCatalogTitles(catalog, {});

  assert.equal(catalog.titlesUpdateAvailable(), true);
  assert.equal(result.unchanged, true);
  assert.equal(catalog.titleCount(), 1);
  assert.equal(catalog.title("tt0000001")?.title, "Existing Title");
  catalog.close();
});

test("force still downloads and reconciles", async () => {
  const catalog = openCatalog();
  seedLocalDump(ratingsPath, { etag: "same-etag-r" }, [
    RATINGS_HEADER,
    "tt0000001\t8.0\t1000",
  ]);
  seedLocalDump(basicsPath, { etag: "same-etag-b" }, [
    BASICS_HEADER,
    "tt0000001\tmovie\tExisting Title\tExisting Title\t0\t1999\t\\N\t100\tDrama",
  ]);
  seedUsableCatalog(catalog, {
    id: "tt0000001",
    fingerprint: "same-etag-r\nsame-etag-b",
  });

  installFetch({
    head: (url) => {
      if (url === urls.ratings) return { etag: "same-etag-r" };
      if (url === urls.basics) return { etag: "same-etag-b" };
      return null;
    },
    get: (url) => {
      if (url === urls.ratings) return gzipTsv([RATINGS_HEADER, "tt0000002\t7.5\t500"]);
      if (url === urls.basics) {
        return gzipTsv([
          BASICS_HEADER,
          "tt0000002\tmovie\tNew Title\tNew Title\t0\t2001\t\\N\t95\tComedy",
        ]);
      }
      throw new Error(`Unexpected download request: ${url}`);
    },
  });

  const result = await buildCatalogTitles(catalog, { force: true });

  assert.equal(result.unchanged, undefined, "force must always reconcile, not early-return");
  assert.equal(catalog.title("tt0000002")?.title, "New Title");
  assert.equal(catalog.titlesUpdateAvailable(), false);
  catalog.close();
});

test("an empty catalogue still ingests", async () => {
  const catalog = openCatalog();

  installFetch({
    head: (url) => {
      if (url === urls.ratings) return { etag: "fresh-etag-r" };
      if (url === urls.basics) return { etag: "fresh-etag-b" };
      return null;
    },
    get: (url) => {
      if (url === urls.ratings) return gzipTsv([RATINGS_HEADER, "tt0000009\t9.0\t200"]);
      if (url === urls.basics) {
        return gzipTsv([
          BASICS_HEADER,
          "tt0000009\tmovie\tBrand New\tBrand New\t0\t2020\t\\N\t110\tAction",
        ]);
      }
      throw new Error(`Unexpected download request: ${url}`);
    },
  });

  const result = await buildCatalogTitles(catalog, {});

  assert.equal(result.unchanged, undefined);
  assert.equal(catalog.titleCount(), 1);
  assert.equal(catalog.title("tt0000009")?.title, "Brand New");
  assert.equal(catalog.titlesUpdateAvailable(), false);
  catalog.close();
});
