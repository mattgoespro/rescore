import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters, SORT_OPTIONS } from "./filters.js";

test("default discover filters do not advertise catalogue fields IMDb dumps lack", () => {
  const filters = defaultFilters() as unknown as Record<string, unknown>;
  assert.equal("keywords" in filters, false);
  assert.equal("providers" in filters, false);
  assert.equal("language" in filters, false);
  assert.equal("cast" in filters, false);
  assert.equal("directors" in filters, false);
});

test("best match is the taste sort, and language exclusion starts empty", () => {
  const filters = defaultFilters();
  assert.deepEqual(filters.excludeLanguages, []);
  assert.equal(
    SORT_OPTIONS.find((option) => option.value === "match")?.label,
    "Best match for you",
  );
});
