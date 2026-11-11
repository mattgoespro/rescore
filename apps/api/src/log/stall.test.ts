import assert from "node:assert/strict";
import { test } from "node:test";
import { createStallWatch } from "./stall.js";

test("stall watch reports a tick that ran a second or more late, once", () => {
  let clock = 0;
  const reports: number[] = [];
  const tick = createStallWatch(
    (ms) => reports.push(ms),
    () => clock,
    250,
    1000,
  );
  clock = 260;
  tick();
  clock = 510 + 4000;
  tick();
  clock = 4510 + 250;
  tick();
  assert.deepEqual(reports, [4000]);
});
