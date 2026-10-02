import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHydrationEventParser,
  hydrationEventsUrl,
} from "./hydration-events";

test("parses hydration SSE frames split across chunks", () => {
  const parser = createHydrationEventParser();

  assert.deepEqual(parser.push(": ping\n\n"), []);
  assert.deepEqual(
    parser.push(
      'event: hydration\ndata: {"processed":32,"total":100,"percent":3,',
    ),
    [],
  );
  assert.deepEqual(
    parser.push('"complete":false,"message":"Loading posters"}\n\n'),
    [
      {
        processed: 32,
        total: 100,
        percent: 3,
        complete: false,
        message: "Loading posters",
      },
    ],
  );
});

test("ignores malformed and unrelated SSE events", () => {
  const parser = createHydrationEventParser();

  assert.deepEqual(
    parser.push(
      [
        "event: other",
        'data: {"processed":32}',
        "",
        "event: hydration",
        'data: {"processed":"32"}',
        "",
      ].join("\n"),
    ),
    [],
  );
});

test("builds the local hydration event endpoint", () => {
  assert.equal(
    hydrationEventsUrl("http://127.0.0.1:3847").toString(),
    "http://127.0.0.1:3847/v1/catalog/hydration/events",
  );
});

test("preserves validated title completion IDs for visible refresh", () => {
  const parser = createHydrationEventParser();
  const [event] = parser.push(`event: hydration\ndata: ${JSON.stringify({ processed: 1, total: 100, percent: 1, complete: false, message: "Loading", completedIds: ["tt0000001", "invalid", 4] })}\n\n`);
  assert.deepEqual(event.completedIds, ["tt0000001"]);
});
