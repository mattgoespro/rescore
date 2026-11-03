import { open } from "node:fs/promises";
import { basename } from "node:path";
import {
  SERVICE_LOG_LINE_LIMIT,
  type ServiceLogLine,
  type ServiceLogRead,
} from "../shared/service-log";

/** How far back a first read, or a read after a rollover, starts. */
export const LOG_TAIL_BYTES = 512 * 1024;

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

/**
 * Reads the service log file from `cursor` (file identity and byte offset)
 * to its last complete line. A new file, or more than `LOG_TAIL_BYTES` of
 * backlog, starts again from the tail.
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { source: "service", reset: true, lines: [], cursor: null };
    throw new Error(
      `Could not read ${basename(path)} (${(error as NodeJS.ErrnoException).code ?? "unknown error"}).`,
    );
  }
  try {
    const info = await handle.stat({ bigint: true });
    const size = Number(info.size);
    const [id, at] = (cursor ?? "").split(":");
    const offset = Number(at);
    const continues =
      id === String(info.ino) &&
      Number.isInteger(offset) &&
      offset <= size &&
      size - offset <= LOG_TAIL_BYTES;
    const start = continues ? offset : Math.max(0, size - LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);
    // A tail starts mid-line; the partial first line is dropped.
    const first = !continues && start > 0 ? buffer.indexOf(10) + 1 : 0;
    const last = buffer.lastIndexOf(10);
    const text = last >= first ? buffer.toString("utf8", first, last + 1) : "";
    return {
      source: "service",
      reset: !continues,
      lines: parseServiceLog(text),
      cursor: `${info.ino}:${last >= first ? start + last + 1 : start + first}`,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Output of the API this session spawned, kept so the log view can show it.
 * The newest `limit` complete lines stay; restarts append. Each stream keeps
 * its own unfinished line, so stdout and stderr never splice together.
 */
export class SessionLog {
  private lines: string[] = [];
  private pending: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };
  private total = 0;
  private started = false;

  constructor(private readonly limit = SERVICE_LOG_LINE_LIMIT * 2) {}

  begin(): void {
    this.started = true;
  }

  append(stream: "stdout" | "stderr", chunk: string): void {
    const parts = (this.pending[stream] + chunk).split("\n");
    this.pending[stream] = parts.pop() ?? "";
    this.push(parts);
  }

  /** The process exited: its unfinished lines are complete. */
  end(): void {
    const rest = [this.pending.stdout, this.pending.stderr].filter(Boolean);
    this.pending = { stdout: "", stderr: "" };
    this.push(rest);
  }

  private push(parts: string[]): void {
    this.lines.push(...parts);
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
    return {
      source: "session",
      reset: !continues,
      lines: parseServiceLog(fresh.join("\n")),
      cursor: String(this.total),
    };
  }
}
