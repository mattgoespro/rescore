import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRetryCredits } from "./credits-retry.js";

test("credits retry once after a failure and not after success", () => {
  assert.equal(shouldRetryCredits(0, false), true);
  assert.equal(shouldRetryCredits(1, false), false);
  assert.equal(shouldRetryCredits(0, true), false);
});
