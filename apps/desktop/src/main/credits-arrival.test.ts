import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogStatus } from "../shared/catalog-status";
import { watchCreditsArrival } from "./credits-arrival";

const status = (patch: Partial<CatalogStatus>): CatalogStatus => ({
  phase: "building",
  message: "",
  titleCount: 10,
  builtAt: null,
  error: null,
  download: null,
  titlesUpdateAvailable: false,
  creditsFailed: false,
  catalogUsable: true,
  ...patch,
});

test("credits arriving after browsing opened reports once", () => {
  let calls = 0;
  const watch = watchCreditsArrival(() => calls++);
  watch(status({ creditsReady: false }));
  watch(status({ creditsReady: false }));
  watch(status({ phase: "ready", creditsReady: true }));
  watch(status({ phase: "ready", creditsReady: true }));
  assert.equal(calls, 1);
});

test("credits already ready at the first status do not report", () => {
  let calls = 0;
  const watch = watchCreditsArrival(() => calls++);
  watch(status({ phase: "ready", creditsReady: true }));
  assert.equal(calls, 0);
});

test("a retry that recovers failed credits reports", () => {
  let calls = 0;
  const watch = watchCreditsArrival(() => calls++);
  watch(status({ creditsReady: true, creditsFailed: true }));
  watch(status({ creditsReady: true, creditsFailed: false }));
  assert.equal(calls, 1);
});
