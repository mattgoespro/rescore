import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatLanguages,
  languageQueryCodes,
  searchLanguages,
} from "./languages.js";

test("language search prefers a name or code prefix", () => {
  assert.equal(searchLanguages("fr")[0]?.name, "French");
  assert.equal(searchLanguages("tam")[0]?.name, "Tamil");
  assert.deepEqual(searchLanguages("zzz"), []);
  assert.equal(
    searchLanguages("cantonese").some((language) => language.id === "cn"),
    true,
  );
});

test("cantonese and hebrew exclusions cover the codes catalogues actually store", () => {
  assert.deepEqual(languageQueryCodes(["cn", "he"]), ["cn", "yue", "he", "iw"]);
});

test("language details format as names", () => {
  assert.equal(formatLanguages(["ja", "en"]), "Japanese, English");
  assert.equal(formatLanguages([]), null);
});
