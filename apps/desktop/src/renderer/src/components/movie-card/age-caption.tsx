import type { JSX } from "react";
import { cn } from "../../lib/cn";

/** Age certificate badge: a tinted chip, red for adult ratings, grey otherwise. */
export default function AgeCaption({
  rating,
  className = "ml-1.5",
}: {
  rating?: string;
  className?: string;
}): JSX.Element | null {
  if (!rating) return null;
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-[3px] px-1.5 py-px align-middle text-[11px] leading-snug font-semibold tracking-[0.04em] text-shadow-none",
        adultRating(rating)
          ? "bg-danger/15 text-danger"
          : "bg-wash-8 text-muted",
        className,
      )}
    >
      {rating}
    </span>
  );
}

function adultRating(rating: string): boolean {
  const normalized = rating.trim().toUpperCase().replace(/\s+/g, "");
  return /^(R|NC-17|TV-MA|MA15\+?|15|16|17|18)$/.test(normalized);
}
