import assert from "node:assert/strict";
import { test } from "node:test";
import { setupReport, SetupTracker } from "./setup-progress.js";

const FILES = ["title.ratings.tsv.gz", "title.basics.tsv.gz"];

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test("parallel downloads add up instead of replacing each other", () => {
  const time = clock();
  const tracker = new SetupTracker(FILES, time.now);
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
  const tracker = new SetupTracker(FILES, time.now);
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
  const tracker = new SetupTracker(FILES, time.now);
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
  const tracker = new SetupTracker(FILES, time.now);
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
