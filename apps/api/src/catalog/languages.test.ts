import assert from "node:assert/strict";
import { test } from "node:test";
import { languageCodes, normalizeLanguageCodes } from "./languages.js";

test("language details keep the original language first and drop duplicates", () => {
  assert.deepEqual(
    languageCodes({
      original_language: "FR",
      spoken_languages: [
        { iso_639_1: "en" },
        { iso_639_1: "fr" },
        { iso_639_1: "xx" },
      ],
    }),
    ["fr", "en"],
  );
  assert.deepEqual(normalizeLanguageCodes(["", "123", "e"]), []);
});
