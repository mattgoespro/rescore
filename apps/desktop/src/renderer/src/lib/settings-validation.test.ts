import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRankingSettings } from "./settings-validation";

const valid = {
  catalogApiUrl: "http://127.0.0.1:3847",
};

test("accepts HTTP catalogue URLs", () => {
  assert.deepEqual(validateRankingSettings(valid, false), {});
});

test("reports an invalid catalogue URL", () => {
  const errors = validateRankingSettings(
    { catalogApiUrl: "file:///catalog" },
    false,
  );
  assert.deepEqual(Object.keys(errors).sort(), ["catalogApiUrl"]);
});

test("packaged builds ignore the hidden development catalogue field", () => {
  assert.deepEqual(
    validateRankingSettings({ ...valid, catalogApiUrl: "" }, true),
    {},
  );
});
