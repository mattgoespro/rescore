import type { JSX } from "react";
import { cn } from "../../lib/cn";

export default function AgeCaption({
  rating,
}: {
  rating?: string;
}): JSX.Element | null {
  if (!rating) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-block rounded-sm border px-1 py-px align-middle text-[10px] font-650 tracking-[0.08em] text-shadow-none",
        dangerSpectrumClass(rating),
      )}
    >
      {rating}
    </span>
  );
}

function dangerSpectrumClass(rating: string): string {
  const normalized = rating.trim().toUpperCase().replace(/\s+/g, "");

  if (/^(R|NC-17|TV-MA|MA15\+?|15|16|17|18)$/.test(normalized)) {
    return "border-(--color-danger-ring) bg-(--color-danger-bg) text-danger-fg";
  }
  if (/^(PG-?13|TV-14|TV-PG|12A?|13|14|M|PG|9|10)$/.test(normalized)) {
    return "border-(--color-danger-border) bg-(--color-danger-bg) text-danger";
  }
  return "border-line bg-wash-3 text-muted";
}
