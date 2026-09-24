import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "./filters.js";

test("default discover filters do not advertise catalogue fields IMDb dumps lack", () => {
  const filters = defaultFilters() as unknown as Record<string, unknown>;
  assert.equal("keywords" in filters, false);
  assert.equal("providers" in filters, false);
  assert.equal("language" in filters, false);
});
