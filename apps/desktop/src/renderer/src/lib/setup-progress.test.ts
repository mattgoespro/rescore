import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogSetupProgress } from "../../../shared/catalog-status";
import { formatBytes, setupPercent, setupView } from "./setup-progress";

const MB = 1024 ** 2;

function setup(
  patch: Partial<CatalogSetupProgress> = {},
): CatalogSetupProgress {
  return {
    step: "download",
    fraction: 0.06,
    files: [
      {
        file: "title.ratings.tsv.gz",
        receivedBytes: 9 * MB,
        totalBytes: 9 * MB,
        done: true,
      },
      {
        file: "title.basics.tsv.gz",
        receivedBytes: 114 * MB,
        totalBytes: 228 * MB,
        done: false,
      },
    ],
    bytesPerSecond: 5.2 * MB,
    index: { stage: "pending", fraction: 0, titles: 0 },
    stepSecondsLeft: 22,
    ...patch,
  };
}

test("the download step shows each file and the total so far", () => {
  const view = setupView(setup(), { rebuilding: false });
  assert.equal(view.heading, "Setting up your catalogue");
  assert.equal(view.firstLaunch, true);
  assert.equal(view.percent, 6);
  assert.equal(view.stepLine, "Step 1 of 2 · Downloading titles");
  assert.equal(view.timeLeft, "Download done in under a minute");
  const [download, index] = view.steps;
  assert.equal(download?.state, "active");
  assert.equal(download?.detail, "123 MB of 237 MB · 5.2 MB/s");
  assert.deepEqual(download?.rows, [
    { name: "title.ratings", percent: 100, caption: "9 MB · done" },
    { name: "title.basics", percent: 50, caption: "114 MB / 228 MB" },
  ]);
  assert.equal(index?.state, "pending");
  assert.equal(index?.detail, "Waiting");
});

test("indexing shows the titles kept and its own bar", () => {
  const view = setupView(
    setup({
      step: "index",
      fraction: 0.56,
      files: setup().files.map((file) => ({
        ...file,
        receivedBytes: file.totalBytes ?? 0,
        done: true,
      })),
      bytesPerSecond: null,
      index: { stage: "titles", fraction: 0.5, titles: 241_000 },
      stepSecondsLeft: 200,
    }),
    { rebuilding: false, locale: "en-US" },
  );
  assert.equal(view.stepLine, "Step 2 of 2 · Indexing titles");
  assert.equal(view.timeLeft, "About 4 min left");
  const [download, index] = view.steps;
  assert.equal(download?.state, "done");
  assert.equal(download?.detail, "237 MB");
  assert.deepEqual(download?.rows, []);
  assert.equal(index?.state, "active");
  assert.equal(index?.detail, "241,000 titles");
  assert.deepEqual(index?.rows, [
    { name: "Reading titles", percent: 50, caption: "50%" },
  ]);
});

test("the closing rebuild has no estimate and says it is finishing", () => {
  const view = setupView(
    setup({
      step: "index",
      fraction: 0.91,
      index: { stage: "finishing", fraction: 0.9, titles: 483_000 },
      stepSecondsLeft: null,
    }),
    { rebuilding: true },
  );
  assert.equal(view.heading, "Rebuilding your catalogue");
  assert.equal(view.firstLaunch, false);
  assert.equal(view.timeLeft, null);
  assert.equal(view.steps[1]?.detail, "Finishing up");
});

test("unknown sizes show the bytes so far", () => {
  const files = setup().files.map((file) => ({ ...file, totalBytes: null }));
  const view = setupView(setup({ files, bytesPerSecond: null }), {
    rebuilding: false,
  });
  assert.equal(view.steps[0]?.detail, "123 MB downloaded");
  assert.equal(view.steps[0]?.rows[1]?.caption, "114 MB");
});

test("the percent never reads as finished while the screen is up", () => {
  assert.equal(setupPercent(1), 99);
  assert.equal(setupPercent(0.999), 99);
  assert.equal(setupPercent(-0.1), 0);
});

test("bytes format by size", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(8 * 1024), "8 KB");
  assert.equal(formatBytes(236.4 * MB), "236 MB");
  assert.equal(formatBytes(1.41 * 1024 ** 3), "1.41 GB");
});
