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
