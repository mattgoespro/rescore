import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp } from "../app.js";
import { CatalogDatabase } from "../catalog/database.js";
import { RatingsStore } from "../services/ratings-store.js";
import { TMDB_HYDRATION_ERROR, interactiveMediaPending } from "./v1.js";

const dirs: string[] = [];

after(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("completed TMDb misses are not pending interactive media", () => {
  assert.equal(interactiveMediaPending(undefined), false);
  assert.equal(
    interactiveMediaPending({
      posterUrl: "",
      synopsis: "",
      certification: "",
    }),
    false,
  );
  assert.equal(
    interactiveMediaPending({
      posterUrl: "https://image.tmdb.org/t/p/w342/x.jpg",
      synopsis: "Plot",
      certification: "",
    }),
    false,
  );
  assert.equal(
    interactiveMediaPending({
      posterUrl: null,
      synopsis: "",
      certification: "",
    }),
    true,
  );
  assert.equal(
    interactiveMediaPending({
      posterUrl: "",
      synopsis: null,
      certification: "PG-13",
    }),
    true,
  );
  assert.equal(
    interactiveMediaPending({
      posterUrl: "",
      synopsis: "",
      certification: null,
    }),
    true,
  );
});

test("interactive hydration skips completed misses and retries keyed failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-hydration-"));
  dirs.push(dir);
  const catalog = new CatalogDatabase(join(dir, "catalog.sqlite"));
  catalog.insertTitleRows([
    {
      id: "tt0000001",
      title: "Confirmed Miss",
      originalTitle: "Confirmed Miss",
      kind: "movie",
      year: 1999,
      runtimeMinutes: 100,
      imdbRating: 7,
      imdbVotes: 100,
      genres: ["Drama"],
    },
    {
      id: "tt0000002",
      title: "Needs Media",
      originalTitle: "Needs Media",
      kind: "movie",
      year: 2001,
      runtimeMinutes: 110,
      imdbRating: 8,
      imdbVotes: 200,
      genres: ["Action"],
    },
  ]);
  catalog.updatePosterUrls([
    {
      id: "tt0000001",
      posterUrl: "https://image.tmdb.org/t/p/w342/keep.jpg",
      synopsis: "Already known",
      certification: "",
    },
  ]);
  const previousKey = process.env.TMDB_API_KEY;
  const previousAppData = process.env.APPDATA;
  const originalFetch = globalThis.fetch;
  let tmdbCalls = 0;
  process.env.TMDB_API_KEY = "test-key";
  process.env.APPDATA = dir;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (href.includes("themoviedb.org")) {
      tmdbCalls += 1;
      return new Response("{}", {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const server = createApp(new RatingsStore(catalog), catalog).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const miss = await fetch(`${base}/v1/titles/tt0000001`);
    const missBody = (await miss.json()) as {
      data: { title: string; certification: string | null };
      error?: string;
    };
    assert.equal(miss.status, 200);
    assert.equal(missBody.data.title, "Confirmed Miss");
    assert.equal(missBody.error, undefined);
    assert.equal(tmdbCalls, 0);

    const missFill = await fetch(`${base}/v1/catalog/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["tt0000001"] }),
    });
    const missFillBody = (await missFill.json()) as {
      data: Array<{ id: string; certification: string | null; error?: string }>;
      error?: string;
    };
    assert.equal(missFill.status, 200);
    assert.equal(missFillBody.data[0]?.certification, "");
    assert.equal(missFillBody.data[0]?.error, undefined);
    assert.equal(missFillBody.error, undefined);
    assert.equal(tmdbCalls, 0);

    const enrich = await fetch(`${base}/v1/catalog/enrich-posters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["tt0000001"] }),
    });
    assert.equal(enrich.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(tmdbCalls, 0);

    const failed = await fetch(`${base}/v1/titles/tt0000002`);
    const failedBody = (await failed.json()) as {
      data: { title: string; posterUrl: string | null };
      error?: string;
    };
    assert.equal(failed.status, 200);
    assert.equal(failedBody.data.title, "Needs Media");
    assert.equal(failedBody.data.posterUrl, null);
    assert.equal(failedBody.error, TMDB_HYDRATION_ERROR);
    assert.equal(tmdbCalls, 1);
    const stillPending = catalog.mediaFor(["tt0000002"])[0];
    assert.equal(stillPending?.posterUrl, null);
    assert.equal(stillPending?.synopsis, null);
    assert.equal(stillPending?.certification, null);

    const retried = await fetch(`${base}/v1/titles/tt0000002`);
    const retriedBody = (await retried.json()) as { error?: string };
    assert.equal(retried.status, 200);
    assert.equal(retriedBody.error, TMDB_HYDRATION_ERROR);
    assert.equal(tmdbCalls, 2);

    const failedFill = await fetch(`${base}/v1/catalog/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["tt0000002"] }),
    });
    const failedFillBody = (await failedFill.json()) as {
      data: Array<{ certification: string | null; error?: string }>;
      error?: string;
    };
    assert.equal(failedFill.status, 200);
    assert.equal(failedFillBody.error, TMDB_HYDRATION_ERROR);
    assert.equal(failedFillBody.data[0]?.certification, null);
    assert.equal(failedFillBody.data[0]?.error, TMDB_HYDRATION_ERROR);
    assert.equal(tmdbCalls, 3);
    assert.equal(catalog.mediaFor(["tt0000002"])[0]?.certification, null);

    delete process.env.TMDB_API_KEY;
    const callsBefore = tmdbCalls;
    const unkeyed = await fetch(`${base}/v1/titles/tt0000002`);
    const unkeyedBody = (await unkeyed.json()) as {
      data: { title: string };
      error?: string;
    };
    assert.equal(unkeyed.status, 200);
    assert.equal(unkeyedBody.data.title, "Needs Media");
    assert.equal(unkeyedBody.error, undefined);
    assert.equal(tmdbCalls, callsBefore);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previousKey;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    catalog.close();
  }
});
