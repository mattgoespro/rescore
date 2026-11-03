import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LOG_TAIL_BYTES,
  SessionLog,
  parseServiceLog,
  readServiceLogFile,
} from "./service-log";

const entry = (time: string, message: string, level = "info"): string =>
  `${time}  api      startup    ${level.padEnd(5)}  ${message}`;

test("parseServiceLog splits the API's columns, including an empty phase", () => {
  const lines = parseServiceLog(
    [
      "09:14:01.902  api      startup    info   Rescore catalogue API listening on http://127.0.0.1:3847",
      "09:16:02.218  http     request    error  req 7f3a  SQLITE_BUSY: database is locked",
      "09:16:03.000  catalog             warn   No phase",
    ].join("\n"),
  );
  assert.deepEqual(lines[0], {
    time: "09:14:01.902",
    channel: "api",
    phase: "startup",
    level: "info",
    message: "Rescore catalogue API listening on http://127.0.0.1:3847",
  });
  assert.equal(lines[1].message, "req 7f3a  SQLITE_BUSY: database is locked");
  assert.deepEqual(
    [lines[2].channel, lines[2].phase, lines[2].level],
    ["catalog", "", "warn"],
  );
});

test("parseServiceLog joins stack frames to their line and ignores CRLF endings", () => {
  const lines = parseServiceLog(
    "    at orphan (db.js:1:1)\r\n09:16:02.218  http     request    error  boom\r\n    at search (db.js:4:1)\r\n",
  );
  assert.deepEqual(
    lines.map((line) => [line.time, line.channel, line.level, line.message]),
    [
      ["", "", "info", "    at orphan (db.js:1:1)"],
      ["09:16:02.218", "http", "error", "boom\n    at search (db.js:4:1)"],
    ],
  );
});

test("parseServiceLog keeps only the newest lines", () => {
  const text = Array.from({ length: 5 }, (_, i) =>
    entry(`09:00:0${i}.000`, `line ${i}`),
  ).join("\n");
  assert.deepEqual(
    parseServiceLog(text, 2).map((line) => line.message),
    ["line 3", "line 4"],
  );
});

test("readServiceLogFile reads only complete lines added since the cursor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    const missing = await readServiceLogFile(path, null);
    assert.deepEqual(missing, {
      source: "service",
      reset: true,
      lines: [],
      cursor: null,
    });
    writeFileSync(path, `${entry("09:00:00.000", "one")}\n09:00:01`);
    const first = await readServiceLogFile(path, null);
    assert.equal(first.reset, true);
    assert.deepEqual(
      first.lines.map((line) => line.message),
      ["one"],
    );
    appendFileSync(path, ".000  api      startup    info   two\n");
    const next = await readServiceLogFile(path, first.cursor);
    assert.equal(next.reset, false);
    assert.deepEqual(
      next.lines.map((line) => line.message),
      ["two"],
    );
    const idle = await readServiceLogFile(path, next.cursor);
    assert.deepEqual([idle.reset, idle.lines], [false, []]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogFile reports a file it cannot open instead of an empty log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    // A name Windows and POSIX both refuse stands in for access denied.
    await assert.rejects(
      readServiceLogFile(join(dir, "bad\0name.log"), null),
      /Could not read bad\0name\.log/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogFile starts from the tail after a rollover or a long gap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    writeFileSync(path, `${entry("09:00:00.000", "old")}\n`);
    const first = await readServiceLogFile(path, null);
    writeFileSync(path, `${entry("09:00:00.000", "new")}\n`);
    const rolled = await readServiceLogFile(path, `${first.cursor}0`);
    assert.equal(rolled.reset, true);
    assert.deepEqual(
      rolled.lines.map((line) => line.message),
      ["new"],
    );
    const filler = "x".repeat(LOG_TAIL_BYTES + 10);
    appendFileSync(path, `${filler}\n${entry("09:00:02.000", "latest")}\n`);
    const behind = await readServiceLogFile(path, rolled.cursor);
    assert.equal(behind.reset, true);
    assert.deepEqual(
      behind.lines.map((line) => line.message),
      ["latest"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionLog returns new lines after a cursor and resets once they have dropped off", () => {
  const log = new SessionLog(3);
  assert.equal(log.read(null).source, "none");
  log.begin();
  log.append("stdout", `${entry("09:00:00.000", "a")}\n09:00:01.000  api  `);
  const first = log.read(null);
  assert.deepEqual(
    first.lines.map((line) => line.message),
    ["a"],
  );
  log.append("stdout", "    startup    info   b\n");
  const next = log.read(first.cursor);
  assert.equal(next.reset, false);
  assert.deepEqual(
    next.lines.map((line) => line.message),
    ["b"],
  );
  for (const name of ["c", "d", "e", "f"])
    log.append("stdout", `${entry("09:00:02.000", name)}\n`);
  const behind = log.read(next.cursor);
  assert.equal(behind.reset, true);
  assert.deepEqual(
    behind.lines.map((line) => line.message),
    ["d", "e", "f"],
  );
});

test("SessionLog keeps each stream's unfinished line apart and flushes them on exit", () => {
  const log = new SessionLog();
  log.begin();
  log.append("stdout", entry("09:00:00.000", "half"));
  log.append("stderr", `${entry("09:00:01.000", "warning", "error")}\n`);
  log.append("stdout", " done\n");
  log.append("stderr", entry("09:00:02.000", "crashed", "error"));
  log.end();
  assert.deepEqual(
    log.read(null).lines.map((line) => line.message),
    ["warning", "half done", "crashed"],
  );
});
