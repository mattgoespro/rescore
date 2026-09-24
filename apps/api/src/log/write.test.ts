import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { emit, emitDownload, resetDownloadLine, type LineSink } from "./write.js";

function capture(isTTY: boolean): { sink: LineSink; chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    sink: { isTTY, write: (chunk) => chunks.push(chunk) },
  };
}

const info = {
  channel: "catalog" as const,
  phase: "download",
  level: "info" as const,
  message: "Checking title.ratings.tsv.gz",
};

beforeEach(() => {
  resetDownloadLine();
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

test("emit writes one plain line when the sink is not a TTY", () => {
  const { sink, chunks } = capture(false);
  emit(info, sink);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /  catalog  download   info   Checking title\.ratings\.tsv\.gz\n$/);
  assert.doesNotMatch(chunks[0] ?? "", /\x1b/);
});

test("debug is dropped unless LOG_LEVEL=debug", () => {
  const { sink, chunks } = capture(false);
  emit({ ...info, level: "debug", message: "probe etag" }, sink);
  assert.equal(chunks.length, 0);
  process.env.LOG_LEVEL = "debug";
  emit({ ...info, level: "debug", message: "probe etag" }, sink);
  assert.match(chunks[0] ?? "", /probe etag/);
});

test("warn passes the default info threshold", () => {
  const { sink, chunks } = capture(false);
  emit({ ...info, level: "warn", message: "Ratings sync failed." }, sink);
  assert.match(chunks[0] ?? "", /warn   Ratings sync failed\./);
});

test("a TTY download redraws with carriage return and the next line breaks first", () => {
  const { sink, chunks } = capture(true);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz" }, false, sink);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz complete" }, true, sink);
  emit({ ...info, phase: "reconcile", message: "Loading IMDb ratings" }, sink);
  assert.match(chunks[0] ?? "", /^\r/);
  assert.doesNotMatch(chunks[0] ?? "", /\n$/);
  assert.match(chunks[1] ?? "", /^\r/);
  assert.match(chunks[1] ?? "", /\n$/);
  assert.match(chunks[2] ?? "", /catalog.*reconcile.*info.*Loading IMDb ratings\n$/);
});

test("a non-TTY download logs start and completion only as full lines", () => {
  const { sink, chunks } = capture(false);
  emitDownload(info, false, sink);
  emitDownload({ ...info, message: "still going" }, false, sink);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz complete" }, true, sink);
  assert.equal(chunks.length, 2);
  assert.match(chunks[0] ?? "", /Checking title\.ratings\.tsv\.gz\n$/);
  assert.match(chunks[1] ?? "", /complete\n$/);
  assert.doesNotMatch(chunks.join(""), /\r/);
});
