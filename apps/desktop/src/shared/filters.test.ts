import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters, SORT_OPTIONS } from "./filters.js";
import { isLanguageCode } from "./languages.js";

test("default discover filters do not advertise catalogue fields IMDb dumps lack", () => {
  const filters = defaultFilters() as unknown as Record<string, unknown>;
  assert.equal("keywords" in filters, false);
  assert.equal("providers" in filters, false);
  assert.equal("language" in filters, false);
  assert.equal("cast" in filters, false);
  assert.equal("directors" in filters, false);
});

test("best match is the taste sort, with the selected default language exclusions", () => {
  const { excludeLanguages } = defaultFilters();
  assert.equal(excludeLanguages.length, 68);
  assert.equal(new Set(excludeLanguages).size, 68);
  for (const code of excludeLanguages) assert.equal(isLanguageCode(code), true);
  for (const code of ["ur", "hi", "bn", "si", "ta", "ml", "bsk", "syl", "bo"])
    assert.ok(excludeLanguages.includes(code as never));
  assert.equal(
    SORT_OPTIONS.find((option) => option.value === "match")?.label,
    "Best match for you",
  );
});

test("changing language exclusions does not change another default filter instance", () => {
  const filters = defaultFilters();
  filters.excludeLanguages.length = 0;
  assert.equal(defaultFilters().excludeLanguages.length, 68);
});
