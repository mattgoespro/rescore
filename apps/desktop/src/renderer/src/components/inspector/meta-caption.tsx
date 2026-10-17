import type { JSX } from "react";

export default function MetaCaption({
  parts,
}: {
  parts: Array<string | number | null | undefined>;
}): JSX.Element {
  return (
    <div className="mb-3.5 text-xs leading-copy text-muted tabular">
      {parts.filter(Boolean).join(" · ")}
    </div>
  );
}
