import assert from "node:assert/strict";
import { test } from "node:test";
import { excludedLibraryStatuses } from "./library-visibility.js";

test("library visibility turns a list kind and hide flags into statuses", () => {
  assert.deepEqual(excludedLibraryStatuses({ kind: "discover" }), ["skipped"]);
  assert.deepEqual(
    excludedLibraryStatuses({
      kind: "discover",
      hideWatched: true,
      hideWatchlist: true,
    }),
    ["skipped", "watched", "watchlist"],
  );
  assert.deepEqual(
    excludedLibraryStatuses({
      kind: "forYou",
      hideWatched: false,
      hideWatchlist: true,
    }),
    ["watched", "skipped"],
  );
});
