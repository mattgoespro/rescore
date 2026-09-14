import type { JSX } from "react";
import { ratingCell } from "../../lib/ui";

export default function RatingScale({
  rating,
  onRate,
}: {
  rating?: number;
  onRate: (n: number) => void;
}): JSX.Element {
  return (
    <div
      className="mb-3.5 flex gap-1"
      role="radiogroup"
      aria-label="Your rating"
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-label={`${n} out of 10`}
          aria-checked={rating === n}
          tabIndex={n === (rating ?? 1) ? 0 : -1}
          className={ratingCell(rating != null && rating >= n)}
          onClick={() => onRate(n)}
          onKeyDown={(event) => {
            let next: number;
            switch (event.key) {
              case "ArrowRight":
              case "ArrowDown":
                next = n === 10 ? 1 : n + 1;
                break;
              case "ArrowLeft":
              case "ArrowUp":
                next = n === 1 ? 10 : n - 1;
                break;
              case "Home":
                next = 1;
                break;
              case "End":
                next = 10;
                break;
              default:
                return;
            }
            event.preventDefault();
            onRate(next);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>("button")
              [next - 1]?.focus();
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
