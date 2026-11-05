import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SERVICE_LOG_LINE_LIMIT } from "../shared/service-log";
import {
  LOG_TAIL_BYTES,
  SessionLog,
  parseServiceLog,
  readServiceLogFile,
  readServiceLogs,
  STDERR_TAIL_ROWS,
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

test("readServiceLogFile adds to the view after a rollover and starts from the tail after a long gap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    writeFileSync(path, `${entry("09:00:00.000", "old")}\n`);
    const first = await readServiceLogFile(path, null);
    writeFileSync(path, `${entry("09:00:00.000", "new")}\n`);
    const rolled = await readServiceLogFile(path, `${first.cursor}0`);
    assert.equal(rolled.reset, false);
    assert.deepEqual(
      rolled.lines.map((line) => [line.level, line.message]),
      [
        ["warn", "Some log lines were skipped when the log rolled over."],
        ["info", "new"],
      ],
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

test("readServiceLogFile keeps unread lines from the file it rolled into", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    const rolledPath = join(dir, "RescoreService.0.out.log");
    writeFileSync(path, `${entry("09:00:00.000", "read")}\n`);
    const first = await readServiceLogFile(path, null);
    appendFileSync(path, `${entry("09:00:01.000", "unread")}\n`);
    renameSync(path, rolledPath);
    writeFileSync(path, `${entry("09:00:02.000", "new")}\n`);
    const next = await readServiceLogFile(path, first.cursor);
    assert.equal(next.reset, false);
    assert.deepEqual(
      next.lines.map((line) => line.message),
      ["unread", "new"],
    );
    const opened = await readServiceLogFile(path, null);
    assert.deepEqual(
      opened.lines.map((line) => line.message),
      ["read", "unread", "new"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogFile keeps its place while the file is missing mid-rollover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    writeFileSync(path, `${entry("09:00:00.000", "read")}\n`);
    const first = await readServiceLogFile(path, null);
    renameSync(path, join(dir, "RescoreService.0.out.log"));
    const missing = await readServiceLogFile(path, first.cursor);
    assert.deepEqual(
      [missing.reset, missing.lines, missing.cursor],
      [false, [], first.cursor],
    );
    writeFileSync(path, `${entry("09:00:01.000", "new")}\n`);
    const next = await readServiceLogFile(path, missing.cursor);
    assert.deepEqual(
      [next.reset, next.lines.map((line) => line.message)],
      [false, ["new"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogFile marks lines lost to more than one rollover", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const path = join(dir, "RescoreService.out.log");
    writeFileSync(path, `${entry("09:00:00.000", "read")}\n`);
    const first = await readServiceLogFile(path, null);
    renameSync(path, join(dir, "RescoreService.1.out.log"));
    const newer = join(dir, "RescoreService.0.out.log");
    writeFileSync(newer, `${entry("09:00:01.000", "missed")}\n`);
    utimesSync(newer, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    writeFileSync(path, `${entry("09:00:02.000", "new")}\n`);
    const next = await readServiceLogFile(path, first.cursor);
    assert.deepEqual(
      next.lines.map((line) => line.message),
      ["Some log lines were skipped when the log rolled over.", "new"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogs caps a stderr tail and heads it once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const errPath = join(dir, "RescoreService.err.log");
    writeFileSync(
      join(dir, "RescoreService.out.log"),
      `${entry("09:00:00.000", "kept")}\n`,
    );
    writeFileSync(errPath, "noise\n".repeat(SERVICE_LOG_LINE_LIMIT + 10));
    const first = await readServiceLogs(dir, null);
    assert.equal(first.lines[0].message, "kept");
    assert.equal(first.lines.length, 1 + 1 + STDERR_TAIL_ROWS);
    appendFileSync(errPath, "more\n");
    const next = await readServiceLogs(dir, first.cursor);
    assert.deepEqual(
      next.lines.map((line) => line.message),
      ["more"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogs reads stderr again when stdout resets the view", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const outPath = join(dir, "RescoreService.out.log");
    writeFileSync(outPath, `${entry("09:00:00.000", "old")}\n`);
    writeFileSync(join(dir, "RescoreService.err.log"), "crash\n");
    const first = await readServiceLogs(dir, null);
    appendFileSync(
      outPath,
      `${"x".repeat(LOG_TAIL_BYTES + 10)}\n${entry("09:00:01.000", "latest")}\n`,
    );
    const next = await readServiceLogs(dir, first.cursor);
    assert.equal(next.reset, true);
    assert.deepEqual(
      [next.lines[0].message, next.lines.at(-1)?.message],
      ["latest", "crash"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readServiceLogs keeps stdout and warns when stderr cannot be read", async () => {
  const read = await readServiceLogs(
    "logs",
    "a:1|b:2",
    async (path, cursor) => {
      if (path.endsWith(".err.log"))
        throw new Error("Could not read RescoreService.err.log (EACCES).");
      return {
        source: "service",
        reset: false,
        lines: parseServiceLog(entry("09:00:00.000", "good")),
        cursor,
      };
    },
  );
  assert.deepEqual(
    [read.lines.map((line) => line.message), read.warning, read.cursor],
    [["good"], "Could not read RescoreService.err.log (EACCES).", "a:1|b:2"],
  );
});

test("readServiceLogs adds stderr as error rows and keeps them when only stderr exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-log-"));
  try {
    const errPath = join(dir, "RescoreService.err.log");
    writeFileSync(errPath, "TypeError: boom\n    at run (index.js:1:1)\n");
    const first = await readServiceLogs(dir, null);
    assert.equal(first.reset, true);
    assert.deepEqual(
      first.lines
        .slice(1)
        .map((line) => [line.channel, line.level, line.message]),
      [
        ["stderr", "error", "TypeError: boom"],
        ["stderr", "error", "    at run (index.js:1:1)"],
      ],
    );
    assert.match(first.lines[0].message, /^Stderr, last written /);
    const idle = await readServiceLogs(dir, first.cursor);
    assert.deepEqual([idle.reset, idle.lines], [false, []]);
    writeFileSync(
      join(dir, "RescoreService.out.log"),
      `${entry("09:00:00.000", "started")}\n`,
    );
    const next = await readServiceLogs(dir, idle.cursor);
    assert.equal(next.reset, false);
    assert.equal(next.lines[0].message, "started");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionLog returns new lines after a cursor and resets once they have dropped off", () => {
  const log = new SessionLog(3);
  assert.equal(log.read(null).source, "none");
  log.begin();
  const output = log.output();
  output.append("stdout", `${entry("09:00:00.000", "a")}\n09:00:01.000  api  `);
  const first = log.read(null);
  assert.deepEqual(
    first.lines.map((line) => line.message),
    ["a"],
  );
  output.append("stdout", "    startup    info   b\n");
  const next = log.read(first.cursor);
  assert.equal(next.reset, false);
  assert.deepEqual(
    next.lines.map((line) => line.message),
    ["b"],
  );
  for (const name of ["c", "d", "e", "f"])
    output.append("stdout", `${entry("09:00:02.000", name)}\n`);
  const behind = log.read(next.cursor);
  assert.equal(behind.reset, true);
  assert.deepEqual(
    behind.lines.map((line) => line.message),
    ["d", "e", "f"],
  );
});

test("SessionLog keeps each stream's unfinished line apart and flushes them on close", () => {
  const log = new SessionLog();
  log.begin();
  const output = log.output();
  output.append("stdout", entry("09:00:00.000", "half"));
  output.append("stderr", `${entry("09:00:01.000", "warning", "error")}\n`);
  output.append("stdout", " done\n");
  output.append("stderr", entry("09:00:02.000", "crashed", "error"));
  output.end();
  assert.deepEqual(
    log.read(null).lines.map((line) => line.message),
    ["warning", "half done", "crashed"],
  );
});

test("SessionLog: an old process closing does not touch the next one's unfinished line", () => {
  const log = new SessionLog();
  log.begin();
  const old = log.output();
  const next = log.output();
  next.append("stdout", entry("09:00:00.000", "half"));
  old.end();
  next.append("stdout", " done\n");
  assert.deepEqual(
    log.read(null).lines.map((line) => line.message),
    ["half done"],
  );
});

test("SessionLog labels plain stderr as error rows, apart from the stdout line before it", () => {
  const log = new SessionLog();
  log.begin();
  const output = log.output();
  output.append("stdout", `${entry("09:00:00.000", "working")}\n`);
  output.append("stderr", "TypeError: boom\n    at run (index.js:1:1)\n");
  assert.deepEqual(
    log
      .read(null)
      .lines.map((line) => [line.channel, line.level, line.message]),
    [
      ["api", "info", "working"],
      ["stderr", "error", "TypeError: boom"],
      ["stderr", "error", "    at run (index.js:1:1)"],
    ],
  );
});

test("SessionLog reports a failed start as an error line, and none before any attempt", () => {
  const log = new SessionLog();
  assert.equal(log.read(null).source, "none");
  log.fail("Could not start the catalogue API: spawn node.exe ENOENT");
  const read = log.read(null);
  assert.equal(read.source, "session");
  assert.deepEqual(
    read.lines.map((line) => [line.level, line.message]),
    [["error", "Could not start the catalogue API: spawn node.exe ENOENT"]],
  );
});
