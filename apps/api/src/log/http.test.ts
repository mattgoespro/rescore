import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  httpMessage,
  incomingMessage,
  requestLog,
  shouldLogRequest,
} from "./http.js";
import { resetDownloadLine, type LineSink } from "./write.js";

test("shouldLogRequest drops healthy polls and keeps failures", () => {
  assert.equal(shouldLogRequest("/health", 200), false);
  assert.equal(shouldLogRequest("/health", 503), true);
  assert.equal(shouldLogRequest("/v1/titles", 200), true);
});

test("httpMessage lists search keys and hides values", () => {
  assert.equal(
    httpMessage({
      id: "ab12",
      status: 200,
      ms: 12,
      path: "/v1/titles",
      query: { query: "heat", sort: "rating" },
    }),
    "ab12  200   12ms  /v1/titles  query,sort",
  );
  assert.equal(
    httpMessage({
      id: "ab12",
      status: 200,
      ms: 12,
      path: "/v1/titles/tt0000001",
      query: { query: "heat" },
    }),
    "ab12  200   12ms  /v1/titles/tt0000001",
  );
});

test("incomingMessage lists search keys and hides values", () => {
  assert.equal(
    incomingMessage({
      id: "ab12",
      path: "/v1/titles",
      query: { query: "heat", sort: "rating" },
    }),
    "ab12  -->   /v1/titles  query,sort",
  );
  assert.equal(
    incomingMessage({
      id: "ab12",
      path: "/v1/titles/tt0000001",
      query: { query: "heat" },
    }),
    "ab12  -->   /v1/titles/tt0000001",
  );
});

test("requestLog writes the incoming line before finish and skips a healthy poll", () => {
  resetDownloadLine();
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: false, write: (chunk) => chunks.push(chunk) };
  const started = Date.now();
  function open(path: string, status: number, query: Record<string, unknown>) {
    const res = new EventEmitter() as EventEmitter & {
      locals: { requestId?: string };
      statusCode: number;
    };
    res.locals = {};
    res.statusCode = status;
    const req = { method: "GET", path, originalUrl: path, query };
    requestLog(req as never, res as never, () => undefined, sink, started);
    return res;
  }
  open("/health", 200, {}).emit("finish");
  assert.equal(chunks.length, 0);

  const titles = open("/v1/titles", 200, { sort: "title", query: "alien" });
  assert.equal(chunks.length, 1);
  assert.match(
    chunks[0] ?? "",
    /  http {5}GET {8}info {3}[0-9a-f]{4}  --> {3}\/v1\/titles  query,sort\n$/,
  );
  titles.emit("finish");
  assert.equal(chunks.length, 2);
  assert.match(
    chunks[1] ?? "",
    /  http {5}GET {8}info {3}[0-9a-f]{4}  200 {3}\d+ms  \/v1\/titles  query,sort\n$/,
  );
  assert.doesNotMatch(chunks.join(""), /health|alien/);

  const failingHealth = open("/health", 503, {});
  assert.equal(chunks.length, 2);
  failingHealth.emit("finish");
  assert.equal(chunks.length, 3);
  assert.match(chunks[2] ?? "", /503 {3}\d+ms  \/health\n$/);
});
