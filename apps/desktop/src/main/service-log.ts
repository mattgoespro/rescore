import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  SERVICE_LOG_LINE_LIMIT,
  type ServiceLogLine,
  type ServiceLogRead,
} from "../shared/service-log";

/** How far back a first read, or a read after a rollover, starts. */
export const LOG_TAIL_BYTES = 512 * 1024;
/** Stderr rows a tail read keeps, so old stderr cannot displace the log itself. */
export const STDERR_TAIL_ROWS = 200;

const LINE =
  /^(\d{2}:\d{2}:\d{2}\.\d{3}) {2}(\S+) +(\S*) +(debug|info|warn|error) +(.*)$/;

/**
 * Splits the API's plain (not terminal) output into log lines. A line that
 * does not start with the clock (a stack frame) continues the line before
 * it; one with nothing before it is returned with an empty time and channel.
 */
export function parseServiceLog(
  text: string,
  limit = SERVICE_LOG_LINE_LIMIT,
): ServiceLogLine[] {
  const lines: ServiceLogLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = LINE.exec(line);
    if (match) {
      lines.push({
        time: match[1],
        channel: match[2],
        phase: match[3],
        level: match[4] as ServiceLogLine["level"],
        message: match[5],
      });
      continue;
    }
    const previous = lines.at(-1);
    if (previous) previous.message += `\n${line}`;
    else
      lines.push({
        time: "",
        channel: "",
        phase: "",
        level: "info",
        message: line,
      });
  }
  return lines.slice(-limit);
}

async function readRange(
  path: string,
  from: number,
  to: number,
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, to - from));
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, from);
    return buffer;
  } finally {
    await handle.close();
  }
}

/** The files WinSW rolled `path` into (RescoreService.0.out.log), newest first. */
async function rolledLogs(
  path: string,
): Promise<Array<{ path: string; id: string; size: number }>> {
  const name = basename(path);
  const stem = name.slice(0, name.indexOf(".") + 1);
  const kind = name.slice(name.indexOf("."), name.lastIndexOf("."));
  const names = (await readdir(dirname(path))).filter(
    (other) =>
      other !== name && other.startsWith(stem) && other.includes(`${kind}.`),
  );
  const logs = await Promise.all(
    names.map(async (other) => {
      const file = join(dirname(path), other);
      const info = await stat(file, { bigint: true });
      return {
        path: file,
        id: String(info.ino),
        size: Number(info.size),
        modified: info.mtimeMs,
      };
    }),
  );
  return logs.sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

/**
 * Text from the file `path` rolled into: what was unread from file `id` at
 * `offset`, or without an `id` the end of the newest one. Rolled files are
 * extra context, so one that cannot be read gives nothing. `complete` says
 * nothing between that file's `offset` and `path` was left out.
 */
async function rolledText(
  path: string,
  id: string | null,
  offset: number,
  budget: number,
): Promise<{ text: string; complete: boolean }> {
  try {
    const logs = await rolledLogs(path);
    const log = id === null ? logs[0] : logs.find((file) => file.id === id);
    if (!log) return { text: "", complete: false };
    const tail = log.size - budget;
    const from = id === null ? Math.max(0, tail) : Math.max(offset, tail);
    const bytes = await readRange(log.path, from, log.size);
    const cut = from > 0 && (id === null || from !== offset);
    const text = bytes.toString("utf8", cut ? bytes.indexOf(10) + 1 : 0);
    return {
      text: text && !text.endsWith("\n") ? `${text}\n` : text,
      complete: log === logs[0] && !cut,
    };
  } catch {
    return { text: "", complete: false };
  }
}

/**
 * Reads the service log file from `cursor` (file identity and byte offset)
 * to its last complete line. After a rollover it adds what was unread in the
 * rolled file and the new file's lines, so nothing shown is replaced. A first
 * read, or more than `LOG_TAIL_BYTES` of backlog, starts again from the tail.
 */
export async function readServiceLogFile(
  path: string,
  cursor: string | null,
): Promise<ServiceLogRead> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    // No file yet is normal before the service first starts; anything else
    // (access denied, a locked file) is reported rather than shown as empty.
    // WinSW also leaves it missing for a moment while rolling; the cursor stays
    // so the next read knows what it has already seen.
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { source: "service", reset: cursor === null, lines: [], cursor };
    throw new Error(
      `Could not read ${basename(path)} (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`,
    );
  }
  try {
    const info = await handle.stat({ bigint: true });
    const size = Number(info.size);
    const [id, at] = (cursor ?? "").split(":");
    const offset = Number(at);
    const known = Number.isInteger(offset);
    const same = known && id === String(info.ino) && offset <= size;
    const rolledOver = known && !same;
    const continues = same && size - offset <= LOG_TAIL_BYTES;
    const start = continues
      ? offset
      : rolledOver && size <= LOG_TAIL_BYTES
        ? 0
        : Math.max(0, size - LOG_TAIL_BYTES);
    const resumed = continues || (rolledOver && start === 0);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);
    // A tail starts mid-line; the partial first line is dropped.
    const first = !resumed && start > 0 ? buffer.indexOf(10) + 1 : 0;
    const last = buffer.lastIndexOf(10);
    const text = last >= first ? buffer.toString("utf8", first, last + 1) : "";
    const room = LOG_TAIL_BYTES - size;
    const older =
      start > 0 || continues
        ? { text: "", complete: true }
        : await rolledText(path, rolledOver ? id : null, offset, room);
    const lines = parseServiceLog(older.text + text);
    if (resumed && !continues && !older.complete)
      lines.unshift({
        time: "",
        channel: "api",
        phase: "",
        level: "warn",
        message: "Some log lines were skipped when the log rolled over.",
      });
    return {
      source: "service",
      reset: !resumed,
      lines,
      cursor: `${info.ino}:${last >= first ? start + last + 1 : start + first}`,
    };
  } finally {
    await handle.close();
  }
}

/** Plain stderr text becomes one error row per line on the stderr channel. */
function stderrRows(lines: ServiceLogLine[]): ServiceLogLine[] {
  return lines.flatMap((line) =>
    line.time || line.channel
      ? [line]
      : line.message.split("\n").map((message) => ({
          ...line,
          channel: "stderr",
          level: "error" as const,
          message,
        })),
  );
}

/**
 * Reads the service's stdout log and, after its lines, its stderr log: stderr
 * carries what the API could not log itself, such as a fatal crash's stack.
 * A stdout reset replaces the view, so stderr is read from its tail again; a
 * stderr failure is a warning, because the stdout lines are still good.
 */
export async function readServiceLogs(
  dir: string,
  cursor: string | null,
  readFile = readServiceLogFile,
): Promise<ServiceLogRead> {
  const [outCursor = "", errCursor = ""] = (cursor ?? "").split("|");
  const errPath = join(dir, "RescoreService.err.log");
  const out = await readFile(
    join(dir, "RescoreService.out.log"),
    outCursor || null,
  );
  const reset = cursor === null || (outCursor !== "" && out.reset);
  let errLines: ServiceLogLine[] = [];
  let nextErrCursor = errCursor;
  let warning: string | undefined;
  try {
    const err = await readFile(errPath, reset ? null : errCursor || null);
    nextErrCursor = err.cursor ?? "";
    errLines = stderrRows(err.lines);
    if (err.reset && errLines.length > 0) {
      // Stderr has no clock of its own, and a tail may be from an earlier run.
      const written = (await stat(errPath)).mtime.toLocaleString();
      errLines = errLines.slice(-STDERR_TAIL_ROWS);
      errLines.unshift({
        time: "",
        channel: "stderr",
        phase: "",
        level: "error",
        message: `Stderr, last written ${written}`,
      });
    }
  } catch (error) {
    warning = error instanceof Error ? error.message : String(error);
  }
  return {
    source: "service",
    reset,
    lines: [...out.lines, ...errLines].slice(-SERVICE_LOG_LINE_LIMIT),
    cursor: `${out.cursor ?? ""}|${nextErrCursor}`,
    ...(warning ? { warning } : {}),
  };
}

export interface ChildOutput {
  append(stream: "stdout" | "stderr", chunk: string): void;
  /** The process closed: its unfinished lines are complete. */
  end(): void;
}

/**
 * Output of the API this session spawned, kept so the log view can show it.
 * The newest `limit` complete lines stay; restarts append. Each stream of each
 * process keeps its own unfinished line, so they never splice together.
 */
export class SessionLog {
  private lines: Array<{ text: string; stderr: boolean }> = [];
  private total = 0;
  private started = false;

  constructor(private readonly limit = SERVICE_LOG_LINE_LIMIT * 2) {}

  begin(): void {
    this.started = true;
  }

  /** Records that the API could not start, in the API's own line format. */
  fail(message: string): void {
    this.started = true;
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    const clock = `${now.toTimeString().slice(0, 8)}.${ms}`;
    this.push([`${clock}  api      startup    error  ${message}`], false);
  }

  /** Where one process writes its output. */
  output(): ChildOutput {
    const pending = { stdout: "", stderr: "" };
    return {
      append: (stream, chunk) => {
        const parts = (pending[stream] + chunk).split("\n");
        pending[stream] = parts.pop() ?? "";
        this.push(parts, stream === "stderr");
      },
      end: () => {
        this.push([pending.stdout].filter(Boolean), false);
        this.push([pending.stderr].filter(Boolean), true);
        pending.stdout = "";
        pending.stderr = "";
      },
    };
  }

  private push(parts: string[], stderr: boolean): void {
    this.lines.push(...parts.map((text) => ({ text, stderr })));
    this.total += parts.length;
    if (this.lines.length > this.limit)
      this.lines.splice(0, this.lines.length - this.limit);
  }

  read(cursor: string | null): ServiceLogRead {
    if (!this.started)
      return { source: "none", reset: true, lines: [], cursor: null };
    const oldest = this.total - this.lines.length;
    const from = Number(cursor);
    const continues =
      cursor !== null &&
      Number.isInteger(from) &&
      from >= oldest &&
      from <= this.total;
    const fresh = this.lines.slice(continues ? from - oldest : 0);
    const lines: ServiceLogLine[] = [];
    for (let at = 0, end = 0; at < fresh.length; at = end) {
      const { stderr } = fresh[at];
      while (end < fresh.length && fresh[end].stderr === stderr) end += 1;
      const text = fresh
        .slice(at, end)
        .map((line) => line.text)
        .join("\n");
      const parsed = parseServiceLog(text);
      lines.push(...(stderr ? stderrRows(parsed) : parsed));
    }
    return {
      source: "session",
      reset: !continues,
      lines: lines.slice(-SERVICE_LOG_LINE_LIMIT),
      cursor: String(this.total),
    };
  }
}
