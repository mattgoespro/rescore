import type { JSX, ReactNode } from "react";

/** A labelled control; an optional value sits right-aligned beside the label. */
export default function Field({
  label,
  value,
  children,
}: {
  label: ReactNode;
  value?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-[13px] text-muted">
      <span className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        {value != null ? (
          <span className="font-semibold text-ink tabular">{value}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}
