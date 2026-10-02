# API Logging Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the API process one film-strip log line for cataloguing work and for HTTP requests, with lab-amber color on a TTY and a plain progress sentence left untouched for the desktop loader.

**Architecture:** A zero-dependency logger in `apps/api/src/log/` formats every line. Catalog code keeps calling `log()` and `reportDownload()`; those functions write the film-strip line and still hand the original sentence to `progressSink`. Express middleware assigns a 4-character request id, skips successful `/health` polls, and prints method, status, duration, path, and (for title search) query-key names only.

**Tech Stack:** Express 5, Node `node:test` via `tsx`, ANSI in `process.stdout` when it is a TTY. No new packages.

## Global Constraints

- Line shape, fixed columns, two spaces between columns: `HH:mm:ss.SSS  <channel>  <phase>  <level>  <message>`.
- Channel width 7. Phase width 9. Level width 5. Time is `HH:mm:ss.SSS` (24-hour, local).
- Channels: `catalog`, `posters`, `ratings`, `http`, `api`.
- Catalog phases: `download`, `reconcile`, `credits`, `posters`, `startup`, `shutdown`. HTTP uses the method (`GET`, `POST`, …) in the phase column.
- Levels: `debug`, `info`, `warn`, `error`. Default minimum is `info`. `debug` prints only when `LOG_LEVEL=debug`.
- Color only when the stream is a TTY. Timestamp stone `\x1b[38;5;245m`. Channels `catalog`, `posters`, `ratings`, and `api` amber `\x1b[38;5;214m`. Channel `http` cyan `\x1b[36m`. Level `info` green `\x1b[32m`, `warn` yellow `\x1b[33m`, `error` red `\x1b[31m`, `debug` gray `\x1b[90m`. The message stays the default foreground. Reset with `\x1b[0m` after each colored column.
- Counts stay inside the sentence. Do not add a separate count field.
- `progressSink` still receives `{ message }` (and `download` when present) with the plain sentence. No ANSI, no film-strip prefix, no request id.
- Download byte updates redraw one line with `\r` on a TTY. A following normal line starts on the next row. When stdout is not a TTY, log a download only at start (`receivedBytes === 0` or no byte payload) and when `receivedBytes >= totalBytes`.
- HTTP line message: `<id>  <status>  <duration>  <path>  <keys>`. `id` is 4 lowercase hex chars. `status` is 3 digits. `duration` is `12ms` under 1000ms, otherwise one decimal seconds (`1.2s`). `keys` is present only for `GET /v1/titles`, is the sorted query-key names joined by commas, and is omitted when there are no keys. Never log query values, headers, or bodies.
- Do not log `GET /health` when status is 200. Log it when status is anything else.
- Successful requests and lifecycle events are `info`. Recoverable failures are `warn`. Status 500 and listen/startup death are `error`. Do not print a stack unless `LOG_LEVEL=debug`.
- API process only. Do not add a dependency. Do not change `apps/desktop/**` or the `console.log` calls that belong only to `apps/api/src/scripts/migrate.ts`, `apps/api/src/scripts/build-catalog.ts`, and `apps/api/src/scripts/enrich-posters.ts`.
- Shared modules the API process imports (`progress.ts`, `gzip-tsv.ts`, `dataset.ts`, `tmdb-posters.ts`, `credits-retry.ts`, `index.ts`, `error.ts`, `v1.ts`) do go through the logger.
- Tests: `npm test --workspace=@rescore/api`. Follow TDD: failing test, minimum implementation, passing run, commit.

---

## File structure

- `apps/api/src/log/format.ts` — pure film-strip formatter and ANSI painter. No I/O.
- `apps/api/src/log/format.test.ts` — column layout, color, query keys, health skip rule.
- `apps/api/src/log/write.ts` — level gate, TTY color, download carriage-return, injectable writer.
- `apps/api/src/log/write.test.ts` — `LOG_LEVEL`, `\r` redraw, plain write when not a TTY.
- `apps/api/src/log/http.ts` — request-id middleware and the finish-line builder.
- `apps/api/src/log/http.test.ts` — health silence, query-key names, 500 line shares the request id.
- `apps/api/src/build/progress.ts` — catalog `log` / `reportDownload` call the writer and still notify `progressSink`.
- `apps/api/src/build/progress.test.ts` — sink receives the plain sentence; stdout receives the film-strip line.
- Call sites that already call `log()` gain an explicit phase argument: `run-build.ts`, `import-basics.ts`, `import-credits.ts`.
- Direct `console.*` in the API process moves to the writer: `index.ts`, `gzip-tsv.ts`, `dataset.ts`, `tmdb-posters.ts`, `credits-retry.ts`, `routes/v1.ts`, `middleware/error.ts`.
- `apps/api/src/app.ts` — mount request logging before routes.

---

### Task 1: Film-strip formatter

**Files:**
- Create: `apps/api/src/log/format.ts`
- Test: `apps/api/src/log/format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type LogLevel = "debug" | "info" | "warn" | "error"`
  - `export type LogChannel = "catalog" | "posters" | "ratings" | "http" | "api"`
  - `export type CatalogPhase = "download" | "reconcile" | "credits" | "posters" | "startup" | "shutdown"`
  - `export interface LogFields { time: Date; channel: LogChannel; phase: string; level: LogLevel; message: string }`
  - `export function formatLine(fields: LogFields, color: boolean): string`
  - `export function padColumn(value: string, width: number): string`
  - `export function formatClock(time: Date): string`
  - `export function formatDuration(ms: number): string`
  - `export function searchKeyList(path: string, query: Record<string, unknown>): string`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatClock,
  formatDuration,
  formatLine,
  searchKeyList,
} from "./format.js";

const at = new Date(2026, 8, 24, 19, 25, 3, 412);

test("formatClock is local HH:mm:ss.SSS", () => {
  assert.equal(formatClock(at), "19:25:03.412");
});

test("formatLine pads channel, phase, and level", () => {
  assert.equal(
    formatLine(
      {
        time: at,
        channel: "catalog",
        phase: "reconcile",
        level: "info",
        message: "Reconciled 482,500 titles",
      },
      false,
    ),
    "19:25:03.412  catalog  reconcile  info   Reconciled 482,500 titles",
  );
});

test("formatLine paints stone, amber, and green and leaves the message plain", () => {
  const line = formatLine(
    {
      time: at,
      channel: "catalog",
      phase: "download",
      level: "info",
      message: "Checking title.basics.tsv.gz",
    },
    true,
  );
  assert.match(line, /^\x1b\[38;5;245m19:25:03\.412\x1b\[0m  \x1b\[38;5;214mcatalog\x1b\[0m  /);
  assert.match(line, /  \x1b\[32minfo\x1b\[0m {3}Checking title\.basics\.tsv\.gz$/);
  assert.doesNotMatch(line, /Checking title\.basics\.tsv\.gz\x1b/);
});

test("http channel is cyan and warn is yellow", () => {
  const line = formatLine(
    {
      time: at,
      channel: "http",
      phase: "GET",
      level: "warn",
      message: "ab12  404     3ms  /v1/titles/tt1",
    },
    true,
  );
  assert.match(line, /\x1b\[36mhttp\x1b\[0m/);
  assert.match(line, /\x1b\[33mwarn\x1b\[0m/);
});

test("formatDuration uses milliseconds under one second and one decimal after", () => {
  assert.equal(formatDuration(12), "12ms");
  assert.equal(formatDuration(1200), "1.2s");
});

test("searchKeyList returns sorted names only for GET title search", () => {
  assert.equal(
    searchKeyList("/v1/titles", { sort: "rating", query: "heat", page: "1" }),
    "page,query,sort",
  );
  assert.equal(searchKeyList("/v1/titles/tt1", { query: "heat" }), "");
  assert.equal(searchKeyList("/v1/people", { q: "nolan" }), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/log/format.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` or `format.js` missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogChannel = "catalog" | "posters" | "ratings" | "http" | "api";
export type CatalogPhase =
  | "download"
  | "reconcile"
  | "credits"
  | "posters"
  | "startup"
  | "shutdown";

export interface LogFields {
  time: Date;
  channel: LogChannel;
  phase: string;
  level: LogLevel;
  message: string;
}

const CHANNEL_WIDTH = 7;
const PHASE_WIDTH = 9;
const LEVEL_WIDTH = 5;

const RESET = "\x1b[0m";
const STONE = "\x1b[38;5;245m";
const AMBER = "\x1b[38;5;214m";
const CYAN = "\x1b[36m";
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

export function padColumn(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

export function formatClock(time: Date): string {
  const h = String(time.getHours()).padStart(2, "0");
  const m = String(time.getMinutes()).padStart(2, "0");
  const s = String(time.getSeconds()).padStart(2, "0");
  const ms = String(time.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function searchKeyList(
  path: string,
  query: Record<string, unknown>,
): string {
  if (path !== "/v1/titles") return "";
  return Object.keys(query).sort().join(",");
}

function paint(text: string, code: string, color: boolean): string {
  if (!color) return text;
  return `${code}${text}${RESET}`;
}

export function formatLine(fields: LogFields, color: boolean): string {
  const clock = paint(formatClock(fields.time), STONE, color);
  const channelColor = fields.channel === "http" ? CYAN : AMBER;
  const channel = paint(padColumn(fields.channel, CHANNEL_WIDTH), channelColor, color);
  const phase = padColumn(fields.phase, PHASE_WIDTH);
  const level = paint(padColumn(fields.level, LEVEL_WIDTH), LEVEL_COLOR[fields.level], color);
  return `${clock}  ${channel}  ${phase}  ${level}  ${fields.message}`;
}
```

`padColumn` is applied before paint so the visible width stays 7 / 9 / 5. Phase is not colored.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=@rescore/api -- src/log/format.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/log/format.ts apps/api/src/log/format.test.ts
git commit -m "feat: add film-strip log line formatter"
```

---

### Task 2: Level gate and download redraw

**Files:**
- Create: `apps/api/src/log/write.ts`
- Test: `apps/api/src/log/write.test.ts`

**Interfaces:**
- Consumes: `formatLine`, `LogChannel`, `LogLevel`, `CatalogPhase` from `./format.js`
- Produces:
  - `export interface LogInput { channel: LogChannel; phase: string; level: LogLevel; message: string }`
  - `export function emit(input: LogInput, sink?: LineSink): void`
  - `export function emitDownload(input: LogInput, done: boolean, sink?: LineSink): void`
  - `export type LineSink = { write: (chunk: string) => void; isTTY: boolean }`
  - `export function resetDownloadLine(): void` — tests call this in `beforeEach` so carriage-return state does not leak

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { emit, emitDownload, resetDownloadLine, type LineSink } from "./write.js";

function capture(isTTY: boolean): { sink: LineSink; chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    sink: { isTTY, write: (chunk) => chunks.push(chunk) },
  };
}

const info = {
  channel: "catalog" as const,
  phase: "download",
  level: "info" as const,
  message: "Checking title.ratings.tsv.gz",
};

beforeEach(() => {
  resetDownloadLine();
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

test("emit writes one plain line when the sink is not a TTY", () => {
  const { sink, chunks } = capture(false);
  emit(info, sink);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /  catalog  download   info   Checking title\.ratings\.tsv\.gz\n$/);
  assert.doesNotMatch(chunks[0] ?? "", /\x1b/);
});

test("debug is dropped unless LOG_LEVEL=debug", () => {
  const { sink, chunks } = capture(false);
  emit({ ...info, level: "debug", message: "probe etag" }, sink);
  assert.equal(chunks.length, 0);
  process.env.LOG_LEVEL = "debug";
  emit({ ...info, level: "debug", message: "probe etag" }, sink);
  assert.match(chunks[0] ?? "", /probe etag/);
});

test("warn passes the default info threshold", () => {
  const { sink, chunks } = capture(false);
  emit({ ...info, level: "warn", message: "Ratings sync failed." }, sink);
  assert.match(chunks[0] ?? "", /warn   Ratings sync failed\./);
});

test("a TTY download redraws with carriage return and the next line breaks first", () => {
  const { sink, chunks } = capture(true);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz" }, false, sink);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz complete" }, true, sink);
  emit({ ...info, phase: "reconcile", message: "Loading IMDb ratings" }, sink);
  assert.match(chunks[0] ?? "", /^\r/);
  assert.doesNotMatch(chunks[0] ?? "", /\n$/);
  assert.match(chunks[1] ?? "", /^\r/);
  assert.match(chunks[1] ?? "", /\n$/);
  assert.match(chunks[2] ?? "", /^Loading IMDb ratings|\n.*Loading IMDb ratings/s);
  assert.match(chunks.join(""), /\n.*catalog  reconcile/);
});

test("a non-TTY download logs start and completion only as full lines", () => {
  const { sink, chunks } = capture(false);
  emitDownload(info, false, sink);
  emitDownload({ ...info, message: "still going" }, false, sink);
  emitDownload({ ...info, message: "Downloading title.ratings.tsv.gz complete" }, true, sink);
  assert.equal(chunks.length, 2);
  assert.match(chunks[0] ?? "", /Checking title\.ratings\.tsv\.gz\n$/);
  assert.match(chunks[1] ?? "", /complete\n$/);
  assert.doesNotMatch(chunks.join(""), /\r/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/log/write.test.ts`

Expected: FAIL with `write.js` missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import { formatLine, type LogChannel, type LogLevel } from "./format.js";

export interface LogInput {
  channel: LogChannel;
  phase: string;
  level: LogLevel;
  message: string;
}

export interface LineSink {
  write: (chunk: string) => void;
  isTTY: boolean;
}

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let downloadOpen = false;
let downloadWidth = 0;

export function resetDownloadLine(): void {
  downloadOpen = false;
  downloadWidth = 0;
}

function threshold(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function enabled(level: LogLevel): boolean {
  return RANK[level] >= RANK[threshold()];
}

function stdout(): LineSink {
  return {
    isTTY: Boolean(process.stdout.isTTY),
    write: (chunk) => process.stdout.write(chunk),
  };
}

function render(input: LogInput, color: boolean): string {
  return formatLine({ ...input, time: new Date() }, color);
}

function closeDownloadIfOpen(sink: LineSink): void {
  if (!downloadOpen) return;
  sink.write("\n");
  downloadOpen = false;
  downloadWidth = 0;
}

export function emit(input: LogInput, sink: LineSink = stdout()): void {
  if (!enabled(input.level)) return;
  closeDownloadIfOpen(sink);
  sink.write(`${render(input, sink.isTTY)}\n`);
}

export function emitDownload(
  input: LogInput,
  done: boolean,
  sink: LineSink = stdout(),
): void {
  if (!enabled(input.level)) return;
  if (!sink.isTTY) {
    if (!done && downloadOpen) return;
    sink.write(`${render(input, false)}\n`);
    downloadOpen = !done;
    return;
  }
  const line = render(input, true);
  const width = Math.max(downloadWidth, line.length);
  const padded = line.padEnd(width, " ");
  downloadWidth = width;
  downloadOpen = !done;
  sink.write(`\r${padded}${done ? "\n" : ""}`);
  if (done) downloadWidth = 0;
}
```

Non-TTY `emitDownload` uses `downloadOpen` so a second in-progress call is skipped and the completion call still prints. `resetDownloadLine()` clears that flag in tests. Call `resetDownloadLine()` at the start of each non-TTY download test if a previous test left it set — `beforeEach` already does.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=@rescore/api -- src/log/write.test.ts`

Expected: PASS, 5 tests.

The TTY test joins chunks and looks for a newline before the reconcile line. `emit` calls `closeDownloadIfOpen`, which writes `\n` when the previous download did not already end in `\n`. After `done: true`, `downloadOpen` is false, so the reconcile line is only `render + \n`. Adjust the third assertion to:

```ts
assert.match(chunks[2] ?? "", /catalog  reconcile  info   Loading IMDb ratings\n$/);
```

and drop the join assertion if `done: true` already terminated the download line. Keep the `\r` assertions on the first two chunks.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/log/write.ts apps/api/src/log/write.test.ts
git commit -m "feat: write catalog logs with a level gate and download redraw"
```

---

### Task 3: Catalog progress keeps the plain sink sentence

**Files:**
- Modify: `apps/api/src/build/progress.ts`
- Modify: `apps/api/src/build/run-build.ts`
- Modify: `apps/api/src/build/import-basics.ts`
- Modify: `apps/api/src/build/import-credits.ts`
- Modify: `apps/api/src/services/gzip-tsv.ts`
- Test: `apps/api/src/build/progress.test.ts`

**Interfaces:**
- Consumes: `emit`, `emitDownload` from `../log/write.js`; `CatalogPhase` from `../log/format.js`
- Produces:
  - `export function log(message: string, phase: CatalogPhase): void` — still calls `progressSink?.({ message })`
  - `export function reportDownload(progress: CatalogBuildProgress): void` — unchanged argument; stdout goes through `emitDownload`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { log, reportDownload, setProgressSink } from "./progress.js";
import { resetDownloadLine, type LineSink } from "../log/write.js";

test("log sends the plain sentence to the sink and a film-strip line to the writer", () => {
  resetDownloadLine();
  const seen: string[] = [];
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: false, write: (chunk) => chunks.push(chunk) };
  setProgressSink((progress) => seen.push(progress.message));
  log("Reconciled 482,500 titles", "reconcile", sink);
  setProgressSink(undefined);
  assert.deepEqual(seen, ["Reconciled 482,500 titles"]);
  assert.match(chunks[0] ?? "", /  catalog  reconcile  info   Reconciled 482,500 titles\n$/);
  assert.doesNotMatch(seen[0] ?? "", /\x1b|catalog  reconcile/);
});

test("mid-download updates the sink every time and redraws once on a TTY", () => {
  resetDownloadLine();
  const seen: Array<number | undefined> = [];
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: true, write: (chunk) => chunks.push(chunk) };
  setProgressSink((progress) => seen.push(progress.download?.receivedBytes));
  const base = {
    message: "Downloading title.ratings.tsv.gz (1 of 2)",
    download: {
      file: "title.ratings.tsv.gz",
      fileIndex: 1,
      fileCount: 2,
      receivedBytes: 0,
      totalBytes: 100,
    },
  };
  reportDownload(base, sink);
  reportDownload({ ...base, download: { ...base.download, receivedBytes: 50 } }, sink);
  reportDownload({ ...base, download: { ...base.download, receivedBytes: 100 } }, sink);
  setProgressSink(undefined);
  assert.deepEqual(seen, [0, 50, 100]);
  assert.equal(chunks.filter((chunk) => chunk.startsWith("\r")).length, 3);
  assert.match(chunks[2] ?? "", /complete\n$/);
});
```

`log` and `reportDownload` gain an optional test sink as the last parameter. Production callers omit it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/build/progress.test.ts`

Expected: FAIL because `log` does not accept a phase or a sink.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/build/progress.ts`:

```ts
import type { CatalogBuildProgress } from "./types.js";
import type { CatalogPhase } from "../log/format.js";
import { emit, emitDownload, type LineSink } from "../log/write.js";

let progressSink: ((progress: CatalogBuildProgress) => void) | undefined;

export function setProgressSink(
  sink: ((progress: CatalogBuildProgress) => void) | undefined,
): void {
  progressSink = sink;
}

export function log(
  message: string,
  phase: CatalogPhase,
  sink?: LineSink,
): void {
  emit({ channel: "catalog", phase, level: "info", message }, sink);
  progressSink?.({ message });
}

export function reportDownload(
  progress: CatalogBuildProgress,
  sink?: LineSink,
): void {
  const bytes = progress.download;
  const started = !bytes || bytes.receivedBytes === 0;
  const finished = Boolean(
    bytes?.totalBytes && bytes.receivedBytes >= bytes.totalBytes,
  );
  if (started || finished || bytes) {
    const message = finished ? `${progress.message} complete` : progress.message;
    emitDownload(
      { channel: "catalog", phase: "download", level: "info", message },
      finished || started,
      sink,
    );
  }
  progressSink?.(progress);
}
```

`emitDownload(..., done)` treats `started` as `done: true` so the "Checking…" line is a normal newline, then in-progress byte updates pass `done: false` only when `!started && !finished`. Replace the call with:

```ts
  if (started || finished || (bytes && bytes.receivedBytes > 0)) {
    const message = finished ? `${progress.message} complete` : progress.message;
    const done = started || finished;
    emitDownload(
      { channel: "catalog", phase: "download", level: "info", message },
      done,
      sink,
    );
  }
```

On a non-TTY, `emitDownload` with `done: false` is skipped after the first open download, which matches Task 2. The TTY test expects three `\r` chunks. `emitDownload` on a TTY always writes `\r`, including when `done` is true. Start (`receivedBytes === 0`) is `done: true`, so it writes `\r...\n` and clears `downloadOpen`. The 50-byte update is `done: false` (`\r` without `\n`). The 100-byte update is `done: true` (`\r...\n`). That is three `\r` writes. The test's `complete\n` assertion stays valid.

Pass a phase at every existing `log()` call:

| File | Call | Phase |
| --- | --- | --- |
| `run-build.ts` | `Title dumps changed remotely…` | `"download"` |
| `run-build.ts` | `Title dumps unchanged…` | `"download"` |
| `run-build.ts` | `Loading IMDb ratings` | `"reconcile"` |
| `run-build.ts` | `Reconciling title.basics` | `"reconcile"` |
| `run-build.ts` | ``Reconciled ${imported…`` | `"reconcile"` |
| `run-build.ts` | ``Titles ready: ${titleCount…`` | `"reconcile"` |
| `run-build.ts` | `Credit dumps unchanged…` | `"credits"` |
| `run-build.ts` | `Reading title.crew` | `"credits"` |
| `run-build.ts` | `Reading title.principals` | `"credits"` |
| `run-build.ts` | ``Resolving ${neededNames…`` | `"credits"` |
| `run-build.ts` | `Writing credits` | `"credits"` |
| `run-build.ts` | `Credits ready` | `"credits"` |
| `import-basics.ts` | ``  scanned ${scanned…} basics`` | `"reconcile"` |
| `import-credits.ts` | crew, principals, and names scan lines | `"credits"` |

Example:

```ts
log("Loading IMDb ratings", "reconcile");
```

In `apps/api/src/services/gzip-tsv.ts`, replace the two `console.log` calls. Add `import { emit } from "../log/write.js";` and:

```ts
    emit({
      channel: "catalog",
      phase: "download",
      level: "info",
      message: `Reusing ${file}`,
    });
```

```ts
  emit({
    channel: "catalog",
    phase: "download",
    level: "info",
    message: `Downloading ${url}`,
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@rescore/api -- src/build/progress.test.ts src/build/run-build.test.ts`

Expected: PASS. `run-build.test.ts` does not assert on log text; it must still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/build/progress.ts apps/api/src/build/progress.test.ts apps/api/src/build/run-build.ts apps/api/src/build/import-basics.ts apps/api/src/build/import-credits.ts apps/api/src/services/gzip-tsv.ts
git commit -m "feat: print catalog progress as film-strip lines"
```

---

### Task 4: One channel vocabulary for startup, ratings, posters, and failures

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/services/dataset.ts`
- Modify: `apps/api/src/services/tmdb-posters.ts`
- Modify: `apps/api/src/services/tmdb-posters.test.ts`
- Modify: `apps/api/src/build/credits-retry.ts`
- Modify: `apps/api/src/routes/v1.ts`

**Interfaces:**
- Consumes: `emit` from `../log/write.js` (path depth varies)
- Produces: no new exports. Poster `log` stays file-private and writes channel `posters`, phase `posters`.

- [ ] **Step 1: Write the failing test**

Update the existing poster test in `apps/api/src/services/tmdb-posters.test.ts`. Replace the `[posters]` filter with a film-strip assertion. The private `log` will call `emit`, which writes to `process.stdout`. Spy on `process.stdout.write` instead of `console.log`:

```ts
test("missing TMDB key is logged once on the posters channel", async () => {
  delete process.env.TMDB_API_KEY;
  delete process.env.APPDATA;
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const catalog = {} as CatalogDatabase;
    await startPosterEnrichment(catalog);
    await startPosterEnrichment(catalog);
  } finally {
    process.stdout.write = original;
  }
  const posterLines = lines.filter((line) => line.includes("posters") && line.includes(MISSING_TMDB_KEY_MESSAGE));
  assert.equal(posterLines.length, 1);
  assert.match(posterLines[0] ?? "", /  posters  posters    info   /);
  assert.doesNotMatch(posterLines[0] ?? "", /stay empty/);
});
```

Phase column is `posters` padded to 9 (`posters` + three spaces). Channel column is `posters` plus one space (width 7). The pattern `  posters  posters    info   ` matches both pads.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/services/tmdb-posters.test.ts`

Expected: FAIL because the line still contains `[posters]` and not `  posters  posters    info   `.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/services/tmdb-posters.ts` — replace the private `log`:

```ts
import { emit } from "../log/write.js";

function log(message: string): void {
  emit({ channel: "posters", phase: "posters", level: "info", message });
}
```

The failure path at the `Poster lookup failed` call stays `info` only if it already was a single sentence. Change that call to `warn` by exporting a second helper or passing level. Replace that one call:

```ts
      emit({
        channel: "posters",
        phase: "posters",
        level: "warn",
        message: `Poster lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
```

Leave the other `log(...)` calls on `info`.

`apps/api/src/index.ts` — import `emit` from `./log/write.js` and replace each console call:

```ts
  emit({
    channel: "api",
    phase: "startup",
    level: "info",
    message: `IMDb catalog API listening on http://127.0.0.1:${PORT}`,
  });
```

```ts
    emit({
      channel: "api",
      phase: "startup",
      level: "error",
      message: `Catalog API port ${PORT} is already in use.`,
    });
```

```ts
    emit({
      channel: "api",
      phase: "startup",
      level: "error",
      message: `Catalog API failed to listen. ${error instanceof Error ? error.message : String(error)}`,
    });
```

When `LOG_LEVEL=debug` and `error instanceof Error && error.stack`, append ` ${error.stack}` on that listen-failure message only. Same rule for the two startup failures below.

```ts
      emit({
        channel: "catalog",
        phase: "startup",
        level: "info",
        message: `Built ${built.titleCount.toLocaleString()} titles at ${built.builtAt}`,
      });
```

```ts
        emit({
          channel: "ratings",
          phase: "startup",
          level: "info",
          message: `Ratings ready (${store.titleCount().toLocaleString()} titles, synced ${store.lastSyncedAt()})`,
        });
```

```ts
        emit({
          channel: "ratings",
          phase: "startup",
          level: "warn",
          message: `Ratings sync failed. ${error instanceof Error ? error.message : String(error)}`,
        });
```

```ts
    emit({
      channel: "catalog",
      phase: "startup",
      level: "error",
      message: `Catalog startup failed. ${error instanceof Error ? error.message : String(error)}`,
    });
```

```ts
    emit({
      channel: "ratings",
      phase: "startup",
      level: "warn",
      message: `Scheduled IMDb ratings refresh failed. ${error instanceof Error ? error.message : String(error)}`,
    });
```

```ts
  emit({
    channel: "api",
    phase: "shutdown",
    level: "info",
    message: `Catalog API stopping (${signal})`,
  });
```

`apps/api/src/services/dataset.ts` — replace `console.warn(...)` with:

```ts
      emit({
        channel: "ratings",
        phase: "startup",
        level: "warn",
        message: `IMDb ratings refresh failed; keeping the last loaded dataset. ${error instanceof Error ? error.message : String(error)}`,
      });
```

Import `emit` from `../log/write.js`.

`apps/api/src/build/credits-retry.ts` — change the default `warn` so it does not call `console.warn`:

```ts
import { emit } from "../log/write.js";

const warn =
  deps.warn ??
  ((message, detail) => {
    emit({
      channel: "catalog",
      phase: "credits",
      level: "warn",
      message: `${message} ${detail instanceof Error ? detail.message : String(detail)}`,
    });
  });
```

`apps/api/src/routes/v1.ts` — replace the rebuild `console.warn` / `console.error`:

```ts
          emit({
            channel: "ratings",
            phase: "reconcile",
            level: "warn",
            message: `Ratings sync after catalog rebuild failed. ${error instanceof Error ? error.message : String(error)}`,
          });
```

```ts
        emit({
          channel: "catalog",
          phase: "reconcile",
          level: "error",
          message: `Catalog rebuild failed. ${error instanceof Error ? error.message : String(error)}`,
        });
```

Import `emit` from `../log/write.js`.

Do not edit `apps/api/src/scripts/migrate.ts`, `build-catalog.ts`, or `enrich-posters.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@rescore/api -- src/services/tmdb-posters.test.ts src/build/credits-retry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/services/dataset.ts apps/api/src/services/tmdb-posters.ts apps/api/src/services/tmdb-posters.test.ts apps/api/src/build/credits-retry.ts apps/api/src/routes/v1.ts
git commit -m "feat: route API lifecycle logs through catalog, ratings, and posters channels"
```

---

### Task 5: HTTP request lines

**Files:**
- Create: `apps/api/src/log/http.ts`
- Test: `apps/api/src/log/http.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/middleware/error.ts`

**Interfaces:**
- Consumes: `emit` from `./write.js`; `formatDuration`, `searchKeyList` from `./format.js`
- Produces:
  - `export function requestId(): string` — 4 lowercase hex chars from `crypto.randomBytes(2)`
  - `export function requestLog(req: express.Request, res: express.Response, next: express.NextFunction): void`
  - `export function httpMessage(input: { id: string; status: number; ms: number; path: string; query: Record<string, unknown> }): string`
  - `export function shouldLogRequest(path: string, status: number): boolean`
  - Request id stored at `res.locals.requestId` as a string

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import request from "supertest";
```

`supertest` is not a dependency. Do not add it. Drive Express with `http.request` against `app.listen(0)`, or call `httpMessage` / `shouldLogRequest` as pure functions and invoke `requestLog` with stub `req`/`res`.

```ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { httpMessage, requestLog, shouldLogRequest } from "./http.js";
import { resetDownloadLine, type LineSink } from "./write.js";

test("shouldLogRequest drops healthy polls and keeps failures", () => {
  assert.equal(shouldLogRequest("/health", 200), false);
  assert.equal(shouldLogRequest("/health", 503), true);
  assert.equal(shouldLogRequest("/v1/titles", 200), true);
});

test("httpMessage lists search keys and hides values", () => {
  assert.equal(
    httpMessage({
      id: "ab12",
      status: 200,
      ms: 12,
      path: "/v1/titles",
      query: { query: "heat", sort: "rating" },
    }),
    "ab12  200    12ms  /v1/titles  query,sort",
  );
  assert.equal(
    httpMessage({
      id: "ab12",
      status: 200,
      ms: 12,
      path: "/v1/titles/tt0000001",
      query: { query: "heat" },
    }),
    "ab12  200    12ms  /v1/titles/tt0000001",
  );
});

test("requestLog writes one http line and skips a 200 health check", () => {
  resetDownloadLine();
  const chunks: string[] = [];
  const sink: LineSink = { isTTY: false, write: (chunk) => chunks.push(chunk) };
  const started = Date.now();
  function run(path: string, status: number, query: Record<string, unknown>) {
    const res = new EventEmitter() as EventEmitter & {
      locals: { requestId?: string };
      statusCode: number;
    };
    res.locals = {};
    res.statusCode = status;
    const req = { method: "GET", path, originalUrl: path, query };
    requestLog(req as never, res as never, () => undefined, sink, started);
    res.emit("finish");
  }
  run("/health", 200, {});
  run("/v1/titles", 200, { sort: "title", query: "alien" });
  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /  http     GET        info   [0-9a-f]{4}  200 +\d+ms  \/v1\/titles  query,sort\n$/);
  assert.doesNotMatch(chunks.join(""), /health|alien/);
});
```

Status column in the message is the 3-digit code followed by three spaces so the column is width 6 (`200   `), then duration. `httpMessage` pads status with `padEnd(6, " ")`.

`requestLog` signature used by the test:

```ts
export function requestLog(
  req: Request,
  res: Response,
  next: NextFunction,
  sink?: LineSink,
  startedAt = Date.now(),
): void
```

Production `app.ts` calls `requestLog` with three arguments. Express ignores extra optional parameters.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/log/http.test.ts`

Expected: FAIL with `http.js` missing.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/log/http.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { formatDuration, searchKeyList } from "./format.js";
import { emit, type LineSink } from "./write.js";

export function requestId(): string {
  return randomBytes(2).toString("hex");
}

export function shouldLogRequest(path: string, status: number): boolean {
  if (path === "/health" && status === 200) return false;
  return true;
}

export function httpMessage(input: {
  id: string;
  status: number;
  ms: number;
  path: string;
  query: Record<string, unknown>;
}): string {
  const status = String(input.status).padEnd(6, " ");
  const duration = formatDuration(input.ms);
  const keys = searchKeyList(input.path, input.query);
  const tail = keys ? `  ${keys}` : "";
  return `${input.id}  ${status}${duration}  ${input.path}${tail}`;
}

export function requestLog(
  req: Request,
  res: Response,
  next: NextFunction,
  sink?: LineSink,
  startedAt = Date.now(),
): void {
  const id = requestId();
  res.locals.requestId = id;
  res.on("finish", () => {
    const status = res.statusCode;
    if (!shouldLogRequest(req.path, status)) return;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    emit(
      {
        channel: "http",
        phase: req.method,
        level,
        message: httpMessage({
          id,
          status,
          ms: Date.now() - startedAt,
          path: req.path,
          query: req.query as Record<string, unknown>,
        }),
      },
      sink,
    );
  });
  next();
}
```

`GET` padded to phase width 9 is `GET      ` (three trailing spaces from the pad in `formatLine`, plus the two-space separator). The test regex `GET        info` expects method plus spaces before `info`. `formatLine` does `padColumn(phase, 9)` then `  ` then the level. `GET` + 6 pad spaces + 2 separator spaces = 8 spaces between `GET` and `info`. The test regex must be `GET {8}info`, not `GET        info` if that count is wrong. Count: `padEnd(9)` on `GET` yields `GET` + 6 spaces. Then two spaces. Total 8. Write the assertion as:

```ts
assert.match(chunks[0] ?? "", /  http     GET {8}info   [0-9a-f]{4}  200 {3}\d+ms  \/v1\/titles  query,sort\n$/);
```

`http` padded to 7 is `http` + 3 spaces. The regex `http     ` is `http` + 5 spaces and will fail. Use `http {3}GET`.

`apps/api/src/app.ts` — after `express.json` and before the routers:

```ts
import { requestLog } from "./log/http.js";
```

```ts
  app.use(requestLog);
```

`apps/api/src/middleware/error.ts` — on status 500, emit one error line that includes `res.locals.requestId`. Do not print the stack unless `process.env.LOG_LEVEL === "debug"`.

```ts
import { emit } from "../log/write.js";

  if (status === 500) {
    const id =
      typeof res.locals.requestId === "string" ? res.locals.requestId : "----";
    const detail = error instanceof Error ? error.message : String(error);
    const stack =
      process.env.LOG_LEVEL === "debug" && error instanceof Error && error.stack
        ? ` ${error.stack}`
        : "";
    emit({
      channel: "http",
      phase: "error",
      level: "error",
      message: `${id}  ${detail}${stack}`,
    });
  }
```

Phase `error` is 5 characters and pads to 9. The access line on `finish` will also be level `error` and will carry the same id, status, duration, and path. Both lines share the id. The error-handler line does not repeat the path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@rescore/api`

Expected: PASS, including `src/log/http.test.ts` and the existing catalog tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/log/http.ts apps/api/src/log/http.test.ts apps/api/src/app.ts apps/api/src/middleware/error.ts
git commit -m "feat: log API requests on one film-strip line"
```

---

## Self-review

Spec coverage:

- Film-strip columns, widths, and clock — Task 1.
- Lab-amber / cyan / status colors, message uncolored, TTY-only — Tasks 1 and 2.
- Channels `catalog`, `posters`, `ratings`, `http`, `api` — Tasks 3, 4, and 5.
- Phases including download redraw — Tasks 2 and 3.
- Four levels and `LOG_LEVEL=debug` — Task 2. Startup and 500s use `error`; recoverable failures use `warn` — Task 4 and Task 5.
- Request id, method, status, duration, path, search keys without values, silent 200 `/health` — Task 5.
- Progress sink stays a plain sentence — Task 3 test.
- No new dependency, scripts' own `console.log` left alone, desktop untouched — Global Constraints and Task 4.

Placeholder scan: every task has a test, an implementation, a command, and a commit. Phase values are listed per call site. Regex space counts in Task 5 are specified so the implementer does not guess `padEnd`.

Type consistency: `emit` / `emitDownload` / `LogInput` / `LineSink` are defined in Task 2 and used unchanged in Tasks 3–5. `log(message, phase)` is defined in Task 3 and the call-site table uses that order. `res.locals.requestId` is set in Task 5 and read by the error handler in the same task. `searchKeyList` only matches `/v1/titles`.
