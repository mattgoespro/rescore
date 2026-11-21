/**
 * Where an arrow key moves from `index` in a list laid out in `columns`, or
 * null when the key is not a move. Left and right move only in a grid. A move
 * past the start stays put; one past the end lands on the last title, as in a
 * grid whose last row is short.
 */
export function arrowTarget(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | null {
  const step =
    key === "ArrowDown"
      ? columns
      : key === "ArrowUp"
        ? -columns
        : key === "ArrowRight" && columns > 1
          ? 1
          : key === "ArrowLeft" && columns > 1
            ? -1
            : null;
  if (step == null) return null;
  const next = index + step;
  return next < 0 ? index : Math.min(count - 1, next);
}
