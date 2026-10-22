import type { JSX } from "react";

export default function Spinner(): JSX.Element {
  return (
    <div
      className="size-6 animate-catalog rounded-full border-2 border-track border-t-accent"
      aria-hidden="true"
    />
  );
}
