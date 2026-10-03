export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogChannel = "catalog" | "posters" | "ratings" | "http" | "api";
export type CatalogPhase =
  "download" | "reconcile" | "credits" | "posters" | "startup" | "shutdown";

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
  return value.length >= width
    ? value.slice(0, width)
    : value.padEnd(width, " ");
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

function coloredColumn(value: string, width: number, code: string): string {
  const clipped = value.length >= width ? value.slice(0, width) : value;
  return `${code}${clipped}${RESET}${" ".repeat(width - clipped.length)}`;
}

export function formatLine(fields: LogFields, color: boolean): string {
  const clock = paint(formatClock(fields.time), STONE, color);
  const channelColor = fields.channel === "http" ? CYAN : AMBER;
  const channel = color
    ? coloredColumn(fields.channel, CHANNEL_WIDTH, channelColor)
    : padColumn(fields.channel, CHANNEL_WIDTH);
  const phase = padColumn(fields.phase, PHASE_WIDTH);
  const level = color
    ? coloredColumn(fields.level, LEVEL_WIDTH, LEVEL_COLOR[fields.level])
    : padColumn(fields.level, LEVEL_WIDTH);
  return `${clock}  ${channel}  ${phase}  ${level}  ${fields.message}`;
}
