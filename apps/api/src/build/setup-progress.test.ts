import assert from "node:assert/strict";
import { test } from "node:test";
import {
  downloadShare,
  mergeSetupTimings,
  NO_SETUP_TIMINGS,
  setupReport,
  SetupTracker,
} from "./setup-progress.js";

const FILES = ["title.ratings.tsv.gz", "title.basics.tsv.gz"];

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test("parallel downloads add up instead of replacing each other", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, NO_SETUP_TIMINGS, time.now);
  tracker.fileProgress("title.ratings.tsv.gz", 5, 10);
  tracker.fileProgress("title.basics.tsv.gz", 20, 190);
  const setup = tracker.snapshot();
  assert.equal(setup.step, "download");
  assert.deepEqual(
    setup.files.map((file) => file.receivedBytes),
    [5, 20],
  );
  // 25 of 200 bytes, inside the download's share of the whole.
  assert.ok(Math.abs(setup.fraction - 0.12 * (25 / 200)) < 1e-9);
});

test("download estimates time left from the speed so far", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, NO_SETUP_TIMINGS, time.now);
  tracker.fileProgress("title.ratings.tsv.gz", 0, 100);
  tracker.fileProgress("title.basics.tsv.gz", 0, 900);
  time.advance(2000);
  tracker.fileProgress("title.ratings.tsv.gz", 100, 100);
  tracker.fileProgress("title.basics.tsv.gz", 100, 900);
  const setup = tracker.snapshot();
  assert.equal(setup.bytesPerSecond, 100);
  assert.equal(setup.stepSecondsLeft, 8);
});

test("files already on disk count as downloaded", () => {
  const tracker = new SetupTracker(FILES);
  tracker.fileDone("title.ratings.tsv.gz", 9);
  tracker.fileDone("title.basics.tsv.gz", 228);
  const setup = tracker.snapshot();
  assert.ok(setup.files.every((file) => file.done));
  assert.ok(Math.abs(setup.fraction - 0.12) < 1e-9);
  assert.equal(setup.bytesPerSecond, null);
});

test("unknown sizes fall back to counting finished files", () => {
  const tracker = new SetupTracker(FILES);
  tracker.fileProgress("title.ratings.tsv.gz", 50, null);
  tracker.fileDone("title.basics.tsv.gz", 200);
  assert.ok(Math.abs(tracker.snapshot().fraction - 0.12 * 0.5) < 1e-9);
  assert.equal(tracker.snapshot().stepSecondsLeft, null);
});

test("indexing moves through ratings, titles and the closing rebuild", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, NO_SETUP_TIMINGS, time.now);
  for (const file of FILES) tracker.fileDone(file, 10);
  tracker.indexStage("ratings");
  tracker.indexBytes(5, 10);
  let setup = tracker.snapshot();
  assert.equal(setup.step, "index");
  assert.equal(setup.index.stage, "ratings");
  assert.ok(Math.abs(setup.index.fraction - 0.015) < 1e-9);

  tracker.indexStage("titles");
  tracker.indexBytes(50, 100);
  tracker.indexTitles(240_000);
  setup = tracker.snapshot();
  assert.ok(Math.abs(setup.index.fraction - (0.03 + 0.87 * 0.5)) < 1e-9);
  assert.equal(setup.index.titles, 240_000);
  assert.ok(
    Math.abs(setup.fraction - (0.12 + 0.88 * setup.index.fraction)) < 1e-9,
  );

  tracker.indexStage("finishing");
  setup = tracker.snapshot();
  assert.ok(Math.abs(setup.index.fraction - 0.9) < 1e-9);
  assert.equal(setup.stepSecondsLeft, null);
});

test("indexing estimates time left once it has run a while", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, NO_SETUP_TIMINGS, time.now);
  tracker.indexStage("titles");
  tracker.indexBytes(1, 100);
  time.advance(1000);
  assert.equal(tracker.snapshot().stepSecondsLeft, null);
  // Half of the index step after 60 s leaves about 60 s more.
  tracker.indexBytes((0.5 - 0.03) / 0.87, 1);
  time.advance(59_000);
  assert.equal(tracker.snapshot().stepSecondsLeft, 60);
});

test("reports are throttled unless forced", () => {
  const time = clock();
  const seen: number[] = [];
  const setup = setupReport(
    FILES,
    (snapshot) => seen.push(snapshot.fraction),
    NO_SETUP_TIMINGS,
    time.now,
    250,
  );
  setup.report();
  setup.report();
  time.advance(100);
  setup.report(true);
  time.advance(100);
  setup.report();
  time.advance(300);
  setup.report();
  assert.equal(seen.length, 3);
});

const MB = 1024 ** 2;

test("measured times weight the download against indexing", () => {
  assert.equal(downloadShare(NO_SETUP_TIMINGS), 0.12);
  // 230 MB at 5 MB/s is 46 s against 6 min of indexing.
  const share = downloadShare({
    downloadBytesPerSecond: 5 * MB,
    downloadBytes: 230 * MB,
    indexSeconds: 360,
  });
  assert.ok(Math.abs(share - 46 / (46 + 360)) < 1e-9);
  // A very slow line still leaves indexing a visible share.
  assert.equal(
    downloadShare({
      downloadBytesPerSecond: 0.1 * MB,
      downloadBytes: 230 * MB,
      indexSeconds: 60,
    }),
    0.6,
  );
});

test("the bar uses the measured share", () => {
  const history = {
    downloadBytesPerSecond: 10 * MB,
    downloadBytes: 200 * MB,
    indexSeconds: 180,
  };
  const tracker = new SetupTracker(FILES, history);
  for (const file of FILES) tracker.fileDone(file, 100 * MB);
  tracker.indexStage("ratings");
  // Download done, nothing indexed: exactly the download's share.
  assert.ok(Math.abs(tracker.snapshot().fraction - 20 / 200) < 1e-9);
});

test("a run measures speed only from downloaded bytes", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, NO_SETUP_TIMINGS, time.now);
  // Ratings was already on disk; basics came over the network.
  tracker.fileDone("title.ratings.tsv.gz", 9 * MB);
  tracker.fileProgress("title.basics.tsv.gz", 0, 200 * MB);
  time.advance(40_000);
  tracker.fileDone("title.basics.tsv.gz", 200 * MB);
  tracker.indexStage("ratings");
  time.advance(120_000);
  tracker.indexStage("done");
  assert.deepEqual(tracker.timings(), {
    downloadBytesPerSecond: 5 * MB,
    downloadBytes: 209 * MB,
    indexSeconds: 120,
  });
});

test("dumps already on disk measure no speed, and an unfinished index no time", () => {
  const tracker = new SetupTracker(FILES);
  for (const file of FILES) tracker.fileDone(file, 100 * MB);
  tracker.indexStage("titles");
  const timings = tracker.timings();
  assert.equal(timings.downloadBytesPerSecond, null);
  assert.equal(timings.downloadBytes, 200 * MB);
  assert.equal(timings.indexSeconds, null);
  assert.deepEqual(
    mergeSetupTimings(
      {
        downloadBytesPerSecond: 4 * MB,
        downloadBytes: 190 * MB,
        indexSeconds: 300,
      },
      timings,
    ),
    {
      downloadBytesPerSecond: 4 * MB,
      downloadBytes: 200 * MB,
      indexSeconds: 300,
    },
  );
});

test("early in indexing the last run's index time estimates the wait", () => {
  const time = clock();
  const tracker = new SetupTracker(
    FILES,
    { downloadBytesPerSecond: null, downloadBytes: null, indexSeconds: 300 },
    time.now,
  );
  tracker.indexStage("ratings");
  assert.equal(tracker.snapshot().stepSecondsLeft, 300);
});
