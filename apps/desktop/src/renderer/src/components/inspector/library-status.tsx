import type { JSX } from "react";

export default function LibraryStatus({
  status,
}: {
  status: string;
}): JSX.Element {
  return (
    <div className="text-[11px] tracking-[0.08em] text-accent-text uppercase">
      In library: {status}
    </div>
  );
}
