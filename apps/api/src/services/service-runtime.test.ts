import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { parseServiceConfig } from "./service-environment.js";
import { permanentFailure, retryDelay } from "./service-retry.js";

test("service configuration rejects malformed credentials, ports, and paths", () => {
  const valid = {
    protocolVersion: 1,
    catalogId: randomUUID(),
    runtimeVersion: "test",
    token: randomBytes(32).toString("hex"),
    port: 40000,
    dataDir: tmpdir(),
  };
  assert.equal(parseServiceConfig(valid).port, 40000);
  for (const patch of [
    { port: 0 },
    { token: "short" },
    { dataDir: "relative" },
    { protocolVersion: 2 },
  ]) {
    assert.throws(() => parseServiceConfig({ ...valid, ...patch }));
  }
  assert.equal(retryDelay(0), 30_000);
  assert.equal(retryDelay(20), 900_000);
  assert.equal(permanentFailure("No usable TMDB API key"), true);
  assert.equal(permanentFailure("fetch failed"), false);
});

test(
  "standalone service builds without Electron, authenticates, stops, and resumes durable data",
  { timeout: 90_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "rescore-service-test-"));
    const files: Record<string, string> = {
      "title.ratings.tsv.gz":
        "tconst\taverageRating\tnumVotes\ntt0000001\t8.2\t2000\n",
      "title.basics.tsv.gz":
        "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\ntt0000001\tmovie\tService Fixture\tService Fixture\t0\t2000\t\\N\t95\tDrama\n",
      "title.crew.tsv.gz":
        "tconst\tdirectors\twriters\ntt0000001\tnm0000001\t\\N\n",
      "title.principals.tsv.gz":
        "tconst\tordering\tnconst\tcategory\tjob\tcharacters\ntt0000001\t1\tnm0000001\tactor\t\\N\t[]\n",
      "name.basics.tsv.gz":
        "nconst\tprimaryName\tbirthYear\tdeathYear\tprimaryProfession\tknownForTitles\nnm0000001\tFixture Person\t1970\t\\N\tactor\ttt0000001\n",
    };
    let tmdbRequests = 0;
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>((resolve) => { releaseMetadata = resolve; });
    let stallDownloads = false;
    let stalledDownloads = 0;
    const upstream = createServer((req, res) => {
      const path = new URL(req.url!, "http://fixture").pathname.slice(1);
      if (path.startsWith("find/")) {
        tmdbRequests++;
        res.setHeader("Content-Type", "application/json");
        void metadataGate.then(() => res.end(JSON.stringify({ movie_results: [], tv_results: [] })));
      } else if (files[path]) {
        const body = gzipSync(
          files[path] +
            "#padding-for-minimum-gzip-size-fixture-only-0123456789\n",
        );
        res.setHeader("ETag", '"fixture-v1"');
        res.setHeader("Content-Length", body.length);
        if (stallDownloads && req.method !== "HEAD") {
          stalledDownloads++;
          res.write(body.subarray(0, 10));
          return;
        }
        res.end(req.method === "HEAD" ? undefined : body);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const config = {
      protocolVersion: 1,
      catalogId: randomUUID(),
      runtimeVersion: "test",
      token: randomBytes(32).toString("hex"),
      port,
      dataDir: join(dir, "data"),
    };
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config));
    const url = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${config.token}` };
    let child: ChildProcess | null = null;
    let exited: Promise<unknown[]> | null = null;
    let output = "";
    function launch(): void {
      const packaged = process.env.RESCORE_TEST_RUNTIME;
      child = spawn(
        packaged ? join(packaged, "node.exe") : process.execPath,
        packaged
          ? [join(packaged, "dist/index.js")]
          : [
              "--import",
              "tsx",
              fileURLToPath(new URL("../index.ts", import.meta.url)),
            ],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            RESCORE_SERVICE_CONFIG: configPath,
            IMDB_DATASETS_BASE: upstreamUrl,
            IMDB_RATINGS_URL: `${upstreamUrl}/title.ratings.tsv.gz`,
            TMDB_API_BASE: upstreamUrl,
          },
        },
      );
      exited = once(child, "exit");
      child.stdout!.on("data", (data) => {
        output += String(data);
      });
      child.stderr!.on("data", (data) => {
        output += String(data);
      });
    }
    async function ready(): Promise<Record<string, unknown>> {
      const end = Date.now() + 20_000;
      while (Date.now() < end) {
        assert.equal(child?.exitCode, null, output);
        try {
          const response = await fetch(`${url}/health`, {
            headers,
            signal: AbortSignal.timeout(1000),
          });
          const health = (await response.json()) as Record<string, unknown>;
          if (health.catalogUsable) return health;
        } catch {
          /* Wait for startup. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Service did not become ready: ${output}`);
    }
    async function stop(): Promise<void> {
      assert.equal(
        (await fetch(`${url}/internal/shutdown`, { method: "POST", headers }))
          .status,
        200,
      );
      const result = await exited;
      assert.equal(result?.[0], 0, output);
      child = null;
    }
    try {
      launch();
      const health = await ready();
      assert.equal(health.runtimeMode, "service");
      assert.equal(health.catalogId, config.catalogId);
      assert.equal((await fetch(`${url}/health`)).status, 401);
      assert.equal(
        (await fetch(`${url}/internal/shutdown`, { method: "POST" })).status,
        401,
      );
      assert.equal((await fetch(`${url}/v1/titles`, { headers })).status, 200);
      assert.equal((health.tmdbHydration as { complete: boolean }).complete, false,
        "Browsing must be ready while TMDb is stalled");
      const detail = await fetch(`${url}/v1/titles/tt0000001`, { headers, signal: AbortSignal.timeout(2000) });
      assert.equal(detail.status, 200, "Details return existing data without waiting for TMDb");
      const progressDeadline = Date.now() + 35_000;
      while ((output.match(/Progress 0\/1/g)?.length ?? 0) < 2 && Date.now() < progressDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok((output.match(/Progress 0\/1/g)?.length ?? 0) >= 2,
        `Stdout must report the retry transition and periodic heartbeat: ${output}`);
      assert.match(output, /Progress 0\/1 \| 0\.0 titles\/s \| retry in \d+s \| last error: 1 TMDb lookups failed/);
      releaseMetadata();
      const completionDeadline = Date.now() + 40_000;
      while (!/Progress 1\/1 .*complete/.test(output) && Date.now() < completionDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const filling = fetch(`${url}/v1/catalog/fill`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["tt0000001"] }) });
      const filled = await (await filling).json() as { data: Array<{ hydrationComplete: boolean }> };
      assert.equal(filled.data[0].hydrationComplete, true);
      assert.equal(tmdbRequests, 2, "Timed-out work retries once; detail and visible requests share background work");
      const lookups = tmdbRequests;
      await stop();
      assert.match(output, /Progress 1\/1 \| [\d.]+ titles\/s \| complete \| last error: none/,
        "Hydration completion must emit a final stdout report");
      const db = new Database(join(config.dataDir, "catalog.sqlite"), {
        readonly: true,
      });
      try {
        assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
        assert.equal(
          (
            db.prepare("SELECT count(*) AS n FROM titles").get() as {
              n: number;
            }
          ).n,
          1,
        );
      } finally {
        db.close();
      }
      launch();
      await ready();
      await stop();
      assert.equal(
        tmdbRequests,
        lookups,
        "Durable TMDb misses must not be requested again",
      );
      launch();
      await ready();
      stallDownloads = true;
      const rebuild = await fetch(`${url}/v1/catalog/rebuild`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      assert.equal(rebuild.status, 202);
      const deadline = Date.now() + 5000;
      while (!stalledDownloads && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(stalledDownloads > 0);
      const stoppedAt = Date.now();
      await stop();
      assert.ok(
        Date.now() - stoppedAt < 5000,
        "Shutdown must cancel a stalled download, not wait for network timeout",
      );
      assert.ok(
        !output.includes(config.token),
        "Service token must not appear in logs",
      );
    } finally {
      releaseMetadata();
      if (child) {
        (child as ChildProcess).kill();
        await exited;
      }
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
