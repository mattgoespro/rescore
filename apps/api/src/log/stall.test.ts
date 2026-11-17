import assert from "node:assert/strict";
import { test } from "node:test";
import { createStallWatch, timeSlowCalls } from "./stall.js";

test("slow call timing names the outermost slow method once and keeps its receiver", () => {
  let clock = 0;
  const reports: string[] = [];
  class Catalog {
    rows = 3;
    count(): number {
      clock += 300;
      return this.rows;
    }
    stats(): number {
      return this.count() * 2;
    }
    quick(): number {
      clock += 10;
      return 1;
    }
  }
  const catalog = timeSlowCalls(
    new Catalog(),
    (method, ms) => reports.push(`${method} ${ms}`),
    () => clock,
    250,
  );
  assert.equal(catalog.stats(), 6);
  assert.equal(catalog.quick(), 1);
  assert.equal(catalog.rows, 3);
  assert.ok(catalog instanceof Catalog);
  assert.deepEqual(reports, ["stats 300"]);
});

test("stall watch reports a busy late tick once, and not a sleeping computer", () => {
  let clock = 0;
  let cpu = 0;
  const reports: number[] = [];
  const tick = createStallWatch(
    (ms) => reports.push(ms),
    () => clock,
    250,
    1000,
    () => cpu,
  );
  clock = 260;
  tick();
  // The thread worked through four seconds.
  clock = 510 + 4000;
  cpu += 3900;
  tick();
  clock = 4510 + 250;
  tick();
  // The computer slept for an hour; the process used no CPU.
  clock = 4760 + 250 + 3_600_000;
  cpu += 5;
  tick();
  assert.deepEqual(reports, [4000]);
});
