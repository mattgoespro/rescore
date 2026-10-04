export function discoverCountLabel(
  total: number | null,
  searching: boolean,
): string {
  if (total == null) return searching ? "Searching…" : "";
  if (searching && total <= 0) return "Searching…";
  if (total <= 0) return "No titles";
  return `${total.toLocaleString()} titles`;
}
