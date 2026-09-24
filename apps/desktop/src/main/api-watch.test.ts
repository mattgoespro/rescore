import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRestartHungChild } from "./api-watch.js";

test("three missed health checks restart a child that has not exited", () => {
  assert.equal(shouldRestartHungChild(2), false);
  assert.equal(shouldRestartHungChild(3), true);
});
