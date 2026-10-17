import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const directory =
  process.argv[2] ?? mkdtempSync(join(tmpdir(), "rescore-library-refresh-"));
mkdirSync(directory, { recursive: true });
const require = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const { chromium } = require("playwright");
const { createServer } = require("vite");
const react = require("@vitejs/plugin-react").default;
const tailwindcss = require("@tailwindcss/vite").default;
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../src/renderer", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
await page.addInitScript(() => {
  const test = (window.__review = { discoverCalls: 0, forYouCalls: 0 });
  let library = [];
  let settings = {
    catalogApiUrl: "http://127.0.0.1:3847",
    rankingMode: "balanced",
    themeMode: "dark",
    accentColor: "#CEAA34",
  };
  const base = {
    mediaType: "movie",
    titleKind: "movie",
    overview: "Fixture",
    posterPath: null,
    backdropPath: null,
    releaseDate: "2000-01-01",
    year: 2000,
    genreIds: [1],
    originalLanguage: "en",
    languages: ["en"],
    popularity: 0,
    voteAverage: 8,
    voteCount: 10000,
    adult: false,
    runtime: 100,
    directorIds: [],
    directorNames: [],
    castIds: [],
    castNames: [],
    certification: "R",
    match: 85,
    reasons: [],
  };
  const movies = [
    { ...base, imdbId: "tt1234567", title: "Review Alpha" },
    { ...base, imdbId: "tt2345678", title: "Review Beta" },
  ];
  const profile = { ready: true, ratedCount: 3, topGenres: [], globalAvg: 8 };
  window.api = {
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    listLibrary: async () => library,
    genres: async () => [{ id: 1, name: "Drama" }],
    profile: async () => profile,
    catalogStatus: async () => ({
      phase: "ready",
      catalogUsable: true,
      creditsReady: true,
      titleCount: 2,
    }),
    onCatalogStatus: () => () => {},
    listSearchHistory: async () => [],
    onImportProgress: () => () => {},
    discover: async (filters) => {
      test.discoverCalls++;
      return {
        results: movies.filter(
          (movie) =>
            !library.some(
              (row) =>
                row.imdbId === movie.imdbId &&
                (row.status === "skipped" ||
                  (filters.hideWatched && row.status === "watched")),
            ),
        ),
        totalResults: 2,
        nextCursor: null,
        canLoadMore: false,
      };
    },
    movie: async (id) => ({
      ...movies.find((movie) => movie.imdbId === id),
      genres: [],
      directors: [],
      cast: [],
    }),
    fillMedia: async (ids) =>
      ids.map((id) => ({
        id,
        posterUrl: null,
        synopsis: "Fixture",
        certification: "R",
        hydrationComplete: true,
      })),
    removeLibrary: async (id) =>
      (library = library.filter((row) => row.imdbId !== id)),
    upsertLibrary: async ({ movie, status, rating }) =>
      (library = [
        ...library.filter((row) => row.imdbId !== movie.imdbId),
        { ...movie, status, rating, updatedAt: new Date().toISOString() },
      ]),
    forYou: async () => {
      test.forYouCalls++;
      return {
        profile,
        insights: [],
        movies: movies.filter(
          (movie) =>
            !library.some(
              (row) => row.imdbId === movie.imdbId && row.status === "watched",
            ),
        ),
      };
    },
    backgroundService: {
      getStatus: async () => ({ supported: false, state: "not-installed" }),
    },
  };
});
const evidence = {};
try {
  await page.goto(server.resolvedUrls.local[0]);
  const results = page.getByRole("list", { name: "Search results" });
  await results.getByRole("button", { name: /Review Alpha/ }).waitFor();
  const inspector = page.getByRole("complementary", { name: "Title details" });
  const searchBefore = await page.evaluate(() => window.__review.discoverCalls);
  await inspector.getByRole("radio", { name: "8 out of 10" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Rated Review Alpha" })
    .waitFor();
  await page.waitForFunction(
    (before) => window.__review.discoverCalls > before,
    searchBefore,
  );
  evidence.discover = {
    remainingAlpha: await results
      .getByRole("button", { name: /Review Alpha/ })
      .count(),
    calls: await page.evaluate(() => window.__review.discoverCalls),
    hideWatched: await page
      .getByRole("checkbox", { name: "Hide watched" })
      .isChecked(),
  };
  assert.equal(evidence.discover.remainingAlpha, 0);
  await page.getByRole("button", { name: "For you", exact: true }).click();
  const ranking = page.getByRole("list", { name: "Ranked titles" });
  await ranking.getByRole("button", { name: /Review Beta/ }).click();
  assert.equal(await inspector.count(), 0);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await inspector.getByRole("heading", { name: "Review Beta R" }).waitFor();
  await inspector.getByRole("radio", { name: "9 out of 10" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Rated Review Beta" })
    .waitFor();
  // Removing then undoing from For You exercises an active library revision
  // without relying on the inspector that now belongs exclusively to Search.
  await inspector.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  await page.getByRole("button", { name: "For you", exact: true }).click();
  await ranking.getByRole("button", { name: /Review Beta/ }).waitFor();
  const rankingBefore = await page.evaluate(() => window.__review.forYouCalls);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(
    (before) => window.__review.forYouCalls > before,
    rankingBefore,
  );
  await page.waitForFunction(
    () =>
      ![
        ...document.querySelectorAll('[aria-label="Ranked titles"] button'),
      ].some((el) => el.textContent.includes("Review Beta")),
  );
  evidence.forYou = {
    remainingBeta: await ranking
      .getByRole("button", { name: /Review Beta/ })
      .count(),
    calls: await page.evaluate(() => window.__review.forYouCalls),
  };
  assert.equal(evidence.forYou.remainingBeta, 0);
  assert.equal(await inspector.count(), 0);
  await page.screenshot({ path: join(directory, "updated-ranking.png") });
  console.log(
    "PASS Search and For You reconcile library writes; only Search renders the inspector",
  );
  writeFileSync(
    join(directory, "renderer.json"),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
