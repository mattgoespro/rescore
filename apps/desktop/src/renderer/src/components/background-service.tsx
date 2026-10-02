import { useEffect, useRef, useState, type JSX } from "react";
import type { BackgroundServiceStatus } from "../../../shared/background-service";
import { btn } from "../lib/ui";

const STATE_LABELS: Record<BackgroundServiceStatus["state"], string> = {
  "not-installed": "Not registered",
  stopped: "Stopped",
  running: "Running",
  transitioning: "Updating service…",
  error: "Needs attention",
};

export default function BackgroundService(): JSX.Element {
  const [status, setStatus] = useState<BackgroundServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const request = useRef<Promise<void> | null>(null);
  const acting = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    function poll(): void {
      if (request.current || acting.current) return;
      const pending = window.api.backgroundService
        .getStatus()
        .then((next) => {
          if (!disposed) setStatus(next);
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not check service status.",
            );
          }
        })
        .finally(() => {
          if (request.current === pending) request.current = null;
        });
      request.current = pending;
    }
    poll();
    const timer = window.setInterval(poll, 5_000);
    return () => {
      disposed = true;
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);

  async function run(
    label: string,
    operation: () => Promise<BackgroundServiceStatus | void>,
  ): Promise<void> {
    if (acting.current) return;
    acting.current = true;
    setAction(label);
    setError("");
    try {
      // Finish any status request before changing service state.
      await request.current;
      const next = await operation();
      if (mounted.current && next) setStatus(next);
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error ? cause.message : "The service action failed.",
        );
      }
    } finally {
      acting.current = false;
      if (mounted.current) setAction(null);
    }
  }

  const busy = action !== null || status?.state === "transitioning";
  return (
    <section
      className="my-4 border-t border-line pt-4"
      aria-labelledby="background-service-heading"
    >
      <h4
        id="background-service-heading"
        className="m-0 text-[13px] font-semibold"
      >
        Background catalogue service
      </h4>
      <p className="text-xs leading-[1.45] text-pretty text-muted">
        Required on Windows. Starts when you open Rescore and keeps the catalog
        updated after you close it.
      </p>
      <p
        role="status"
        className="text-xs leading-[1.45] text-muted"
        aria-busy={busy}
      >
        {action ??
          (status ? STATE_LABELS[status.state] : "Checking service status…")}
        {status?.message && status.state !== "error"
          ? ` · ${status.message}`
          : ""}
      </p>
      <p role="alert" className="text-xs leading-[1.45] text-danger">
        {error || (status?.state === "error" ? status.message : "")}
      </p>
      <div className="flex flex-wrap gap-2">
        {status?.supported && status.state !== "running" && (
          <button type="button" className={btn("primary")} disabled={busy}
            onClick={() => void run("Preparing service�", () => window.api.backgroundService.retry())}>
            Retry
          </button>
        )}
        <button
          type="button"
          className={btn()}
          disabled={busy || !status?.logsAvailable}
          onClick={() =>
            void run("Opening logs…", () =>
              window.api.backgroundService.openLogs(),
            )
          }
        >
          Open logs
        </button>
      </div>
    </section>
  );
}
