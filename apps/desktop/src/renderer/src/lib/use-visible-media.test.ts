import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEDIA_FILL_LIMIT,
  clearPendingRetries,
  mediaIdsToFill,
  invalidateCompletedMedia,
  mergeMediaRows,
  mergeTitleMedia,
} from "./use-visible-media";

test("poster fill skips resolved ids and ids still inside the retry window", () => {
  const ids = Array.from({ length: 45 }, (_, index) => `tt${index}`);
  const resolved = new Set(["tt0"]);
  const retryAt = new Map([["tt1", 2_000]]);
  const picked = mediaIdsToFill({
    ids,
    resolved,
    retryAt,
    now: 1_000,
    limit: MEDIA_FILL_LIMIT,
  });
  assert.equal(MEDIA_FILL_LIMIT, 40);
  assert.equal(picked.includes("tt0"), false);
  assert.equal(picked.includes("tt1"), false);
  assert.equal(picked.length, 40);
  assert.equal(picked[0], "tt2");

  const pending = new Map([
    ["tt1", 2_000],
    ["tt2", 2_000],
  ]);
  clearPendingRetries(pending, ["tt1", "tt2"], new Set(["tt2"]));
  assert.equal(pending.has("tt1"), false);
  assert.equal(pending.has("tt2"), true);
});

test("visible media distinguishes pending, absent, and available posters", () => {
  const title = {
    imdbId: "tt1",
    posterPath: null,
    posterStatus: "pending" as const,
  };
  const row = {
    id: "tt1",
    synopsis: null,
    certification: null,
    hydrationComplete: false,
  };
  assert.equal(
    mergeTitleMedia(title, new Map([["tt1", { ...row, posterUrl: null }]]))
      .posterStatus,
    "pending",
  );
  assert.equal(
    mergeTitleMedia(
      title,
      new Map([["tt1", { ...row, posterUrl: "", hydrationComplete: true }]]),
    ).posterStatus,
    "unavailable",
  );
  assert.equal(
    mergeTitleMedia(
      title,
      new Map([["tt1", { ...row, posterUrl: "/found.jpg" }]]),
    ).posterStatus,
    "available",
  );
});

test("periodic hydration refreshes visible titles previously resolved as missing", () => {
  const resolved = new Set(["tt1", "tt2"]);
  const retryAt = new Map([["tt1", 9_000]]);
  invalidateCompletedMedia(retryAt, resolved, ["tt1"]);
  assert.deepEqual(
    mediaIdsToFill({ ids: ["tt1", "tt2"], resolved, retryAt, now: 1_000 }),
    ["tt1"],
  );
});

test("media rows keep the newest titles within the limit", () => {
  const row = (id: string) => ({ id });
  let media = mergeMediaRows(new Map(), [row("a"), row("b"), row("c")], 3);
  media = mergeMediaRows(media, [row("a"), row("d")], 3);
  assert.deepEqual([...media.keys()], ["c", "a", "d"]);
});

test("media merge keeps the same map when no row changes", () => {
  const row = (id: string, posterUrl: string | null) => ({
    id,
    synopsis: null,
    posterUrl,
    certification: null,
    hydrationComplete: false,
  });
  const media = mergeMediaRows(new Map(), [row("a", null)]);
  assert.equal(mergeMediaRows(media, [row("a", null)]), media);
  assert.equal(mergeMediaRows(media, []), media);
  assert.notEqual(mergeMediaRows(media, [row("a", "/p.jpg")]), media);
});
