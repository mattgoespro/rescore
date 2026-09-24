import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { CatalogDatabase } from "../catalog/index.js";
import { TMDB_POSTER_CONCURRENCY, TMDB_POSTER_GAP_MS } from "../config.js";
import {
  MISSING_TMDB_KEY_MESSAGE,
  pickMovieCertification,
  pickTvCertification,
  startPosterEnrichment,
} from "./tmdb-posters.js";

afterEach(() => {
  delete process.env.TMDB_API_KEY;
});

test("poster lookups stay at two workers with a gap", () => {
  assert.equal(TMDB_POSTER_CONCURRENCY, 2);
  assert.equal(TMDB_POSTER_GAP_MS, 300);
});

test("age rating prefers the configured region, then the US theatrical certificate", () => {
  assert.equal(
    pickMovieCertification(
      {
        results: [
          {
            iso_3166_1: "GB",
            release_dates: [{ certification: "15", type: 3 }],
          },
          {
            iso_3166_1: "US",
            release_dates: [
              { certification: "PG-13", type: 3 },
              { certification: "R", type: 1 },
            ],
          },
        ],
      },
      "US",
    ),
    "PG-13",
  );
  assert.equal(
    pickTvCertification(
      {
        results: [
          { iso_3166_1: "US", rating: "TV-MA" },
          { iso_3166_1: "DE", rating: "16" },
        ],
      },
      "DE",
    ),
    "16",
  );
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
