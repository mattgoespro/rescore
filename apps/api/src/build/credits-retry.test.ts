import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recoverCreditsFailure,
  shouldRetryCredits,
} from "./credits-retry.js";

test("credits retry once after a failure and not after success", () => {
  assert.equal(shouldRetryCredits(0, false), true);
  assert.equal(shouldRetryCredits(1, false), false);
  assert.equal(shouldRetryCredits(0, true), false);
});

test("second credits failure is contained without rethrowing", async () => {
  let failed = false;
  let retries = 0;
  const warnings: string[] = [];

  await recoverCreditsFailure(new Error("first failure"), {
    setCreditsFailed: (value) => {
      failed = value;
    },
    creditsReady: () => false,
    retry: async () => {
      retries += 1;
      throw new Error("second failure");
    },
    delay: async () => {
      /* no 60s sleep in unit tests */
    },
    warn: (message) => {
      warnings.push(message);
    },
  });

  assert.equal(retries, 1);
  assert.equal(failed, true);
  assert.deepEqual(warnings, [
    "Credits import failed.",
    "Credits import retry failed.",
  ]);
});
