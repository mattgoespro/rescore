import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";
import Spinner from "./catalog-loader/spinner";

/** Place inside a relative content container; completed content may stay mounted. */
export default function LoadingOverlay({
  busy,
  loadingText = "Loading…",
  completeText,
  icon,
  detail,
  children,
  inline = false,
}: {
  busy: boolean;
  loadingText?: string;
  completeText?: string;
  icon?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  inline?: boolean;
}): JSX.Element | null {
  if (!busy && !completeText) return null;
  return (
    <div
      data-loading-overlay=""
      data-busy={busy}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={busy}
      className={cn(
        "flex flex-col gap-3 text-[13px] text-muted",
        inline
          ? "w-full items-start"
          : "absolute inset-0 z-3 items-center justify-center overflow-auto bg-canvas/90 p-4 text-center",
      )}
    >
      {busy ? icon === undefined ? <Spinner /> : icon : null}
      <p className="m-0 text-[13px] font-medium text-ink">
        {busy ? loadingText : completeText}
      </p>
      {detail ? (
        <div className="max-w-140 text-[13px] leading-relaxed">{detail}</div>
      ) : null}
      {children}
    </div>
  );
}
