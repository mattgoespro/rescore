import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CatalogDatabase } from "../catalog/index.js";
import {
  MISSING_TMDB_KEY_MESSAGE,
  startPosterEnrichment,
} from "./tmdb-posters.js";

afterEach(() => {
  delete process.env.TMDB_API_KEY;
});

test("missing TMDB key is logged once and does not claim posters stay empty", async () => {
  delete process.env.TMDB_API_KEY;
  delete process.env.APPDATA;
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const catalog = {} as CatalogDatabase;
    await startPosterEnrichment(catalog);
    await startPosterEnrichment(catalog);
  } finally {
    console.log = original;
  }
  const posterLines = lines.filter((line) => line.includes("[posters]"));
  assert.equal(posterLines.length, 1);
  assert.match(posterLines[0] ?? "", new RegExp(MISSING_TMDB_KEY_MESSAGE));
  assert.doesNotMatch(posterLines[0] ?? "", /stay empty/);
});
