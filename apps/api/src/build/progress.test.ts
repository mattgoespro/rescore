import assert from "node:assert/strict";
import { test } from "node:test";
import { log, reportDownload, setProgressSink } from "./progress.js";
import { resetDownloadLine, type LineSink } from "../log/write.js";

test("log sends the plain sentence to the sink and a film-strip line to the writer", () => {
  resetDownloadLine();
  const seen: string[] = [];
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: false, write: (chunk) => chunks.push(chunk) };
  setProgressSink((progress) => seen.push(progress.message));
  log("Reconciled 482,500 titles", "reconcile", sink);
  setProgressSink(undefined);
  assert.deepEqual(seen, ["Reconciled 482,500 titles"]);
  assert.match(
    chunks[0] ?? "",
    /  catalog  reconcile  info   Reconciled 482,500 titles\n$/,
  );
  assert.doesNotMatch(seen[0] ?? "", /\x1b|catalog  reconcile/);
});

test("mid-download updates the sink every time and redraws once on a TTY", () => {
  resetDownloadLine();
  const seen: Array<number | undefined> = [];
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: true, write: (chunk) => chunks.push(chunk) };
  setProgressSink((progress) => seen.push(progress.download?.receivedBytes));
  const base = {
    message: "Downloading title.ratings.tsv.gz (1 of 2)",
    download: {
      file: "title.ratings.tsv.gz",
      fileIndex: 1,
      fileCount: 2,
      receivedBytes: 0,
      totalBytes: 100,
    },
  };
  reportDownload(base, sink);
  reportDownload(
    { ...base, download: { ...base.download, receivedBytes: 50 } },
    sink,
  );
  reportDownload(
    { ...base, download: { ...base.download, receivedBytes: 100 } },
    sink,
  );
  setProgressSink(undefined);
  assert.deepEqual(seen, [0, 50, 100]);
  assert.equal(chunks.filter((chunk) => chunk.startsWith("\r")).length, 3);
  assert.match(chunks[2] ?? "", /complete\n$/);
});
