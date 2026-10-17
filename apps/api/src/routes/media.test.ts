import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";

test("failed and legacy partial images are retried; concurrent downloads publish one complete file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rescore-media-test-"));
  process.env.POSTER_CACHE_DIR = directory;
  const { mediaHandler } = await import("./media.js");
  const app = express();
  app.get("/media", mediaHandler);
  app.use(((_error, _req, res, _next) => {
    res.status(502).end();
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const originalFetch = globalThis.fetch;
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=",
    "base64",
  );
  const upstream = "https://image.tmdb.org/t/p/w185/fixture.jpg";
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media?src=${encodeURIComponent(upstream)}`;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== upstream) return originalFetch(input, init);
    calls++;
    if (calls === 1)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(image.subarray(0, 4));
            setTimeout(
              () => controller.error(new Error("Interrupted upstream")),
              20,
            );
          },
        }),
        { headers: { "content-type": "image/png" } },
      );
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(image, {
      headers: {
        "content-type": "image/png",
        "content-length": String(image.length),
      },
    });
  };
  try {
    const failed = await fetch(url);
    assert.equal(failed.status, 502);
    await failed.arrayBuffer();
    mkdirSync(join(directory, "w185"), { recursive: true });
    const hash = createHash("sha1").update(upstream).digest("hex");
    writeFileSync(join(directory, "w185", `${hash}.jpg`), image.subarray(0, 4));
    const responses = await Promise.all([fetch(url), fetch(url)]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    }
    const cached = await fetch(url);
    assert.deepEqual(Buffer.from(await cached.arrayBuffer()), image);
    assert.equal(calls, 2);
    assert.ok(
      readdirSync(join(directory, "w185")).every(
        (file) => !file.endsWith(".tmp"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
