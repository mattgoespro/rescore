import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogHealthReady,
  progressPhase,
} from "./ensure-catalog.js";

test("usable catalog stays ready during dump checks", () => {
  assert.equal(progressPhase(true), "ready");
  assert.equal(progressPhase(true, false), "ready");
});

test("empty or forced catalogs still report building", () => {
  assert.equal(progressPhase(false), "building");
  assert.equal(progressPhase(true, true), "building");
});

test("health stays ready when titles exist even if a check is in flight", () => {
  assert.equal(catalogHealthReady(482_500, "ready", true), true);
  assert.equal(catalogHealthReady(482_500, "building", true), true);
});

test("health is not ready during a first build or error", () => {
  assert.equal(catalogHealthReady(0, "building", false), false);
  assert.equal(catalogHealthReady(100, "error", true), false);
  assert.equal(catalogHealthReady(0, "idle", false), false);
});
