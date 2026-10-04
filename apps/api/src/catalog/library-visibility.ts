import type { LibraryStatus } from "../catalog-types.js";

export function excludedLibraryStatuses(input: {
  kind: "discover" | "forYou";
  hideWatched?: boolean;
  hideWatchlist?: boolean;
}): LibraryStatus[] {
  if (input.kind === "forYou") return ["watched", "skipped"];
  const excluded: LibraryStatus[] = ["skipped"];
  if (input.hideWatched) excluded.push("watched");
  if (input.hideWatchlist) excluded.push("watchlist");
  return excluded;
}
