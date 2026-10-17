import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatLanguages,
  isLanguageCode,
  languageQueryCodes,
  searchLanguages,
} from "./languages.js";
import { IMDB_LANGUAGES } from "./imdb-languages";
import type { DiscoverFilters } from "./filters";

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

test("the IMDb vocabulary includes dialects, sign languages, and no dialogue", () => {
  assert.equal(IMDB_LANGUAGES.length, 377);
  assert.equal(new Set(IMDB_LANGUAGES.map(({ id }) => id)).size, 377);
  for (const { id, name } of IMDB_LANGUAGES) {
    assert.equal(isLanguageCode(id), true);
    assert.ok(
      searchLanguages(name, 400).some(
        (option) => option.id === id || option.name === name,
      ),
    );
  }
  assert.equal(searchLanguages("American Sign Language")[0]?.id, "ase");
  assert.equal(searchLanguages("Mandarin")[0]?.id, "cmn");
  assert.equal(searchLanguages("Klingon")[0]?.id, "tlh");
  assert.equal(searchLanguages("None")[0]?.id, "zxx");
});

test("language exclusions form a finite literal union with explicit compatibility codes", () => {
  const valid: DiscoverFilters["excludeLanguages"] = [
    "en",
    "ase",
    "qbo",
    "zxx",
    "cn",
    "iw",
    "ig",
    "nb",
    "nn",
    "fy",
  ];
  assert.ok(valid.every(isLanguageCode));
  // @ts-expect-error Arbitrary strings must not be assignable to filter codes.
  const invalid: DiscoverFilters["excludeLanguages"] = ["not-a-language"];
  assert.equal(isLanguageCode(invalid[0]), false);
  assert.equal(isLanguageCode("zz"), false);
  assert.equal(isLanguageCode(null), false);
});
