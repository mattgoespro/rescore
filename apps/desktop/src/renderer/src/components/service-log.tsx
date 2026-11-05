import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  SERVICE_LOG_LINE_LIMIT,
  appendLogLines,
  type ServiceLogLevel,
  type ServiceLogLine,
  type ServiceLogRead,
} from "../../../shared/service-log";
import type { CatalogStatus } from "../../../shared/types";
import { CATALOG_INDICATOR_COLOR, catalogIndicator } from "../lib/catalog-busy";
import { cn } from "../lib/cn";
import { errorMessage } from "../lib/error-message";
import { pollWhileVisible } from "../lib/poll-while-visible";
import {
  btn,
  chipClass,
  iconBtn,
  searchIconClass,
  searchInputClass,
  segmentedCell,
  segmentedGroup,
} from "../lib/ui";
import { IconClose, IconSearch } from "./icons";
import { useNotificationHost } from "./notifications";

const LEVELS: ReadonlyArray<{ id: ServiceLogLevel; label: string }> = [
  { id: "debug", label: "All" },
  { id: "info", label: "Info" },
  { id: "warn", label: "Warnings" },
  { id: "error", label: "Errors" },
];
const RANK: Record<ServiceLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const CHANNELS = [
  "catalog",
  "posters",
  "ratings",
  "http",
  "api",
  "stderr",
] as const;
const LEVEL_TEXT: Record<ServiceLogLevel, string> = {
  debug: "text-faint",
  info: "text-ok",
  warn: "text-warn",
  error: "text-danger",
};
const ROW_TINT: Record<ServiceLogLevel, string> = {
  debug: "",
  info: "",
  warn: "bg-warn/6",
  error: "bg-danger/6",
};
/** The file is local, so a read is cheap; it only runs while the log is open. */
const POLL_MS = 1_000;
/** Scrolling further than this above the bottom stops following new lines. */
const FOLLOW_SLACK_PX = 24;

interface Row extends ServiceLogLine {
  id: number;
}

const isProgress = (line: ServiceLogLine): boolean =>
  line.message.startsWith("Progress ");

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

function lineText(line: ServiceLogLine): string {
  return [line.time, line.channel, line.phase, line.level, line.message]
    .filter(Boolean)
    .join("  ");
}

const LogRow = memo(function LogRow({ row }: { row: Row }): JSX.Element {
  return (
    <div
      className={cn(
        "grid grid-cols-[96px_64px_76px_44px_minmax(0,1fr)] gap-3 px-5 py-px",
        ROW_TINT[row.level],
      )}
    >
      <span className="text-faint">{row.time}</span>
      <span
        className={row.channel === "http" ? "text-muted" : "text-accent-text"}
      >
        {row.channel}
      </span>
      <span className="text-faint">{row.phase}</span>
      <span className={cn("font-medium", row.channel && LEVEL_TEXT[row.level])}>
        {row.channel ? row.level : ""}
      </span>
      <span className="wrap-break-word whitespace-pre-wrap">{row.message}</span>
    </div>
  );
});

/**
 * Full-window view of the catalogue API's log: the Windows service's log
 * file, or the output of the API this session started. It follows new lines
 * until the user scrolls up; Follow new lines resumes.
 */
export default function ServiceLog({
  catalogStatus,
  onRetry,
  onClose,
}: {
  catalogStatus: CatalogStatus | null;
  /** Settles once the retry request has been handled. */
  onRetry: () => Promise<unknown>;
  onClose: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<ServiceLogRead["source"] | null>(null);
  // A failed read clears once a later read succeeds; a failed copy or folder
  // open stays until the next action.
  const [pollError, setPollError] = useState("");
  const [actionError, setActionError] = useState("");
  const [level, setLevel] = useState<ServiceLogLevel>("info");
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  const [hideProgress, setHideProgress] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const setNotificationHost = useNotificationHost();
  useEffect(() => {
    dialog.current?.showModal();
    // Outside a modal dialog, notifications would be covered and inert.
    setNotificationHost(dialog.current);
    return () => {
      setNotificationHost(null);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    };
  }, [setNotificationHost]);

  useEffect(() => {
    let disposed = false;
    let reading = false;
    let cursor: string | null = null;
    let nextId = 0;
    function poll(): void {
      if (reading) return;
      reading = true;
      window.api.backgroundService
        .readLog(cursor)
        .then((read) => {
          if (disposed) return;
          cursor = read.cursor;
          setSource(read.source);
          setPollError(read.warning ?? "");
          const fresh = read.lines.map((line) => ({ ...line, id: nextId++ }));
          if (read.reset)
            setRows((current) =>
              fresh.length === 0 && current.length === 0 ? current : fresh,
            );
          else if (fresh.length > 0)
            setRows((current) => appendLogLines(current, fresh));
        })
        .catch((cause: unknown) => {
          if (!disposed)
            setPollError(
              errorMessage(cause, "Could not read the catalogue log."),
            );
        })
        .finally(() => {
          reading = false;
        });
    }
    const stopPolling = pollWhileVisible(poll, POLL_MS);
    return () => {
      disposed = true;
      stopPolling();
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        RANK[row.level] >= RANK[level] &&
        !hidden.includes(row.channel) &&
        !(hideProgress && isProgress(row)) &&
        (!needle ||
          row.message.toLowerCase().includes(needle) ||
          row.phase.includes(needle)),
    );
  }, [rows, level, hidden, hideProgress, query]);

  const counts = useMemo(() => {
    const byLevel: Record<ServiceLogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    for (const row of rows)
      for (const { id } of LEVELS)
        if (RANK[row.level] >= RANK[id]) byLevel[id] += 1;
    return byLevel;
  }, [rows]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (follow && element) element.scrollTop = element.scrollHeight;
  }, [visible, follow]);

  const indicator = catalogIndicator(catalogStatus);

  async function copyVisible(): Promise<void> {
    setActionError("");
    try {
      await navigator.clipboard.writeText(visible.map(lineText).join("\n"));
      setCopied(true);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    } catch (cause) {
      setActionError(errorMessage(cause, "Could not copy the log lines."));
    }
  }

  const empty =
    source === "none"
      ? "Rescore did not start this catalogue API, so its log is not available here. Its output is in the terminal that runs it."
      : rows.length > 0
        ? "No lines match. Clear the search or widen the filters."
        : pollError ||
          (source === null
            ? "Reading the catalogue log…"
            : "No log lines yet. The catalogue service writes here once it starts.");

  return (
    <dialog
      ref={dialog}
      aria-labelledby="service-log-title"
      className="fixed inset-0 top-12 m-0 size-auto max-h-none max-w-none bg-transparent p-4 text-ink backdrop:bg-canvas/70 open:flex"
      onClose={onClose}
    >
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-app border border-line bg-rail">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
            <h2 id="service-log-title" className="m-0 text-base font-semibold">
              Catalogue service log
            </h2>
            <p className="m-0 text-xs leading-copy text-muted">
              {source === "session"
                ? "Output of the catalogue API this session starts."
                : source === "service"
                  ? "RescoreService.out.log and its stderr log, written by the RescoreCatalogue service."
                  : source === "none"
                    ? "No log is available for this catalogue API."
                    : pollError
                      ? "The catalogue log could not be read."
                      : "Reading the catalogue log…"}
            </p>
          </div>
          <span className="flex h-7 items-center gap-2 rounded-full bg-wash-6 px-2.5 text-xs font-medium">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-pip",
                CATALOG_INDICATOR_COLOR[indicator.state],
              )}
            />
            {indicator.tip}
          </span>
          <button
            type="button"
            aria-label="Close log"
            className={iconBtn("bare")}
            onClick={() => dialog.current?.close()}
          >
            <IconClose className="size-4.5" />
          </button>
        </header>

        {indicator.state === "failed" ? (
          <div
            role="alert"
            className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-line bg-danger/8 px-5 py-4"
          >
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1">
              <p className="m-0 text-sm font-semibold">{indicator.tip}</p>
              <p className="m-0 text-sm leading-copy text-muted">
                {indicator.detail}
              </p>
            </div>
            <button
              type="button"
              className={btn("primary", "small")}
              aria-disabled={retrying}
              onClick={() => {
                if (retrying) return;
                setRetrying(true);
                setActionError("");
                onRetry()
                  .catch((cause: unknown) =>
                    setActionError(
                      errorMessage(cause, "Could not restart the catalogue."),
                    ),
                  )
                  .finally(() => setRetrying(false));
              }}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-line px-5 py-3">
          <label className="relative flex h-8 max-w-90 min-w-0 flex-[1_1_240px] items-center">
            <span className="sr-only">Search log lines</span>
            <IconSearch className={searchIconClass} />
            <input
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder="Search messages"
              className={cn(searchInputClass, "pr-3")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape clears a search before it closes the log.
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
            />
          </label>
          <div
            role="group"
            aria-label="Lowest level shown"
            className={segmentedGroup("icon")}
          >
            {LEVELS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={level === option.id}
                className={segmentedCell(level === option.id, "icon")}
                onClick={() => setLevel(option.id)}
              >
                {option.label}
                <span className="text-xs font-normal text-faint tabular">
                  {counts[option.id].toLocaleString("en-US")}
                </span>
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="Channels"
            className="flex flex-wrap gap-1.5"
          >
            {CHANNELS.map((channel) => {
              const on = !hidden.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    chipClass(on),
                    "h-7 px-2.5",
                    !on && "text-faint",
                  )}
                  onClick={() =>
                    setHidden((current) =>
                      on
                        ? [...current, channel]
                        : current.filter((name) => name !== channel),
                    )
                  }
                >
                  {channel}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={hideProgress}
              className={cn(chipClass(hideProgress), "h-7 px-2.5")}
              onClick={() => setHideProgress((current) => !current)}
            >
              Hide progress
            </button>
          </div>
          <span className="flex-1" />
          <button
            type="button"
            aria-pressed={follow}
            className={btn("small")}
            onClick={() => setFollow((current) => !current)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-pip",
                follow ? "bg-ok" : "bg-control",
              )}
            />
            Follow new lines
          </button>
        </div>

        <div
          ref={scroller}
          role="log"
          // Lines arrive every second; reading each one aloud is noise.
          aria-live="off"
          aria-label="Catalogue service log lines"
          className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-xs leading-description"
          onScroll={(event) => {
            // Only scrolling away pauses. The browser also scrolls when a
            // filter shortens the log, so reaching the bottom does not resume.
            const element = event.currentTarget;
            if (
              element.scrollHeight - element.scrollTop - element.clientHeight >
              FOLLOW_SLACK_PX
            )
              setFollow(false);
          }}
        >
          {visible.length > 0 ? (
            <div className="min-w-190 py-1.5">
              {visible.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </div>
          ) : (
            <p className="m-0 px-5 py-10 text-center font-sans text-ui text-muted">
              {empty}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-2.5 text-xs text-muted">
          <span className="tabular">
            {visible.length === rows.length
              ? plural(rows.length, "line")
              : `${visible.length.toLocaleString("en-US")} of ${plural(rows.length, "line")}`}
            {rows.length >= SERVICE_LOG_LINE_LIMIT ? " (newest kept)" : ""}
          </span>
          <p role="alert" className="m-0 text-danger empty:hidden">
            {actionError || pollError}
          </p>
          <span className="flex-1" />
          <button
            type="button"
            className={btn("compact")}
            disabled={visible.length === 0}
            onClick={() => void copyVisible()}
          >
            {copied ? "Copied" : "Copy shown lines"}
          </button>
          {source === "service" ? (
            <button
              type="button"
              className={btn("compact")}
              onClick={() => {
                setActionError("");
                void window.api.backgroundService
                  .openLogs()
                  .catch((cause: unknown) =>
                    setActionError(
                      errorMessage(cause, "Could not open the log folder."),
                    ),
                  );
              }}
            >
              Open log folder
            </button>
          ) : null}
        </footer>
      </section>
    </dialog>
  );
}
