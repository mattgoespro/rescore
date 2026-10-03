import assert from "node:assert/strict";
import { test } from "node:test";
import {
  settleHealthMiss,
  shouldRestartHungChild,
  shouldSpawnReplacement,
} from "./api-watch.js";

test("three missed health checks restart a child that has not exited", () => {
  assert.equal(shouldRestartHungChild(2), false);
  assert.equal(shouldRestartHungChild(3), true);
});

test("an open port is the running API, even when this process did not spawn it", () => {
  assert.equal(
    shouldSpawnReplacement({ childAlive: false, portOpen: true }),
    false,
  );
  assert.equal(
    shouldSpawnReplacement({ childAlive: true, portOpen: false }),
    false,
  );
  assert.equal(
    shouldSpawnReplacement({ childAlive: false, portOpen: false }),
    true,
  );
});

test("an open port resets settle instead of giving up", () => {
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: true, missed: 8 }),
    "reset",
  );
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: false, missed: 7 }),
    "wait",
  );
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: false, missed: 8 }),
    "give-up",
  );
  assert.equal(
    settleHealthMiss({ childAlive: true, portOpen: false, missed: 8 }),
    "wait",
  );
});
