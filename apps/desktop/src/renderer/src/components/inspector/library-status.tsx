import type { JSX } from "react";

export default function LibraryStatus({
  status,
}: {
  status: string;
}): JSX.Element {
  return (
    <div className="text-[11px] tracking-kicker text-accent-text uppercase">
      In library: {status}
    </div>
  );
}
