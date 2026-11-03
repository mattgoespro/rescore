import assert from "node:assert/strict";
import { test } from "node:test";
import { appendLogLines, type ServiceLogLine } from "./service-log";

const line = (
  time: string,
  channel: string,
  level: ServiceLogLine["level"],
  message: string,
): ServiceLogLine => ({ time, channel, phase: "", level, message });

test("appendLogLines joins leading stack frames to the last shown line", () => {
  const shown = [line("09:00:00.000", "http", "error", "boom")];
  const next = appendLogLines(shown, [
    line("", "", "info", "    at search (db.js:4:1)"),
    line("09:00:01.000", "api", "info", "later"),
  ]);
  assert.deepEqual(
    next.map((row) => [row.level, row.message]),
    [
      ["error", "boom\n    at search (db.js:4:1)"],
      ["info", "later"],
    ],
  );
  assert.equal(shown[0].message, "boom");
});

test("appendLogLines keeps the newest lines and an orphan frame with nothing before it", () => {
  const next = appendLogLines(
    [],
    [
      line("", "", "info", "orphan"),
      line("09:00:01.000", "api", "info", "a"),
      line("09:00:02.000", "api", "info", "b"),
    ],
    2,
  );
  assert.deepEqual(
    next.map((row) => row.message),
    ["a", "b"],
  );
});
