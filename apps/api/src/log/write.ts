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
