import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldDeferTitleIngest } from "./defer-ingest.js";

test("a usable catalogue with a new remote fingerprint is not parsed", () => {
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 482_500,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "old-etag\nold-basics",
      remoteFingerprint: "new-etag\nold-basics",
    }),
    true,
  );
});

test("force, an empty catalogue, and a matching fingerprint still ingest or skip as before", () => {
  assert.equal(
    shouldDeferTitleIngest({
      force: true,
      titleCount: 482_500,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "old",
      remoteFingerprint: "new",
    }),
    false,
  );
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 0,
      builtAt: null,
      storedFingerprint: null,
      remoteFingerprint: "new",
    }),
    false,
  );
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 10,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "same",
      remoteFingerprint: "same",
    }),
    false,
  );
});
