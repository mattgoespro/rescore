import type { JSX } from "react";

export default function Spinner(): JSX.Element {
  return (
    <div
      className="size-7 animate-catalog rounded-full border-2 border-accent/18 border-t-accent shadow-(--shadow-accent-glow)"
      aria-hidden="true"
    />
  );
}
