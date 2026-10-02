import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSettings } from "./settings";

test("drops stored TMDb keys from settings", () => {
  const settings = normalizeSettings({
    tmdbApiKey: "legacy-key",
    tmdbApiKeys: ["first-key", "second-key"],
  });
  assert.equal("tmdbApiKey" in settings, false);
  assert.equal("tmdbApiKeys" in settings, false);
});
