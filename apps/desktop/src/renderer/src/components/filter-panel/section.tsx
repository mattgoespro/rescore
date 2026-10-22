import type { JSX, ReactNode } from "react";

/** A labelled group of filters; groups are spaced wider than their contents. */
export default function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="kicker">{title}</h3>
      {children}
      {hint ? (
        <p className="m-0 text-xs leading-label text-faint">{hint}</p>
      ) : null}
    </section>
  );
}
