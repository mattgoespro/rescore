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

test("drops unsupported region and IMDb endpoint settings when loading old profiles", () => {
  const settings = normalizeSettings({
    region: "ZA",
    imdbApiUrl: "https://obsolete.example",
  });
  assert.equal("region" in settings, false);
  assert.equal("imdbApiUrl" in settings, false);
});
