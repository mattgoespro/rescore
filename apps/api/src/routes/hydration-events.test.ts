import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  closeHydrationEventStreams,
  createHydrationEventsRouter,
} from "./hydration-events.js";
import { publishTmdbHydration } from "../services/ensure-catalog.js";

test("hydration events send an initial snapshot and durable updates", async () => {
  publishTmdbHydration({
    processed: 25,
    total: 100,
    complete: false,
    message: "Writing TMDb records",
  });
  const app = express();
  app.use("/v1/catalog/hydration", createHydrationEventsRouter());
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/catalog/hydration/events`,
    );
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/event-stream/,
    );
    const reader = response.body?.getReader();
    assert.ok(reader);
    assert.deepEqual(await nextEvent(reader), {
      processed: 25,
      total: 100,
      percent: 25,
      complete: false,
      message: "Writing TMDb records",
    });

    publishTmdbHydration({
      processed: 50,
      total: 100,
      complete: false,
      message: "Writing TMDb records",
    });
    assert.deepEqual(await nextEvent(reader), {
      processed: 50,
      total: 100,
      percent: 50,
      complete: false,
      message: "Writing TMDb records",
    });
    await reader.cancel();
  } finally {
    closeHydrationEventStreams();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<unknown> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("SSE stream ended before an event arrived");
    text += decoder.decode(chunk.value, { stream: true });
  }
  const line = text.split("\n").find((value) => value.startsWith("data: "));
  if (!line) throw new Error("SSE event had no data line");
  return JSON.parse(line.slice("data: ".length));
}
