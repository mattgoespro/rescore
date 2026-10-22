// Browser regression checks against the current renderer; all IPC data is isolated.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const output =
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "rescore-ui-")));
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../src/renderer", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
page.setDefaultTimeout(10000);
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};

await page.addInitScript(() => {
  const control = (window.__uiTest = {
    settingsWrites: 0,
    failSave: false,
    failRemove: false,
    failUpsert: false,
    discoverCalls: 0,
    historyWrites: 0,
    searchDelay: 120,
    healthMode: "normal",
    catalogListeners: new Set(),
    status: {
      phase: location.search.includes("loading") ? "starting" : "ready",
      catalogUsable: !location.search.includes("loading"),
      creditsReady: true,
      titleCount: 1000,
      builtAt: "2026-10-01T00:00:00Z",
    },
    importHandler: null,
  });
  let settings = {
    catalogApiUrl: "http://127.0.0.1:3847",
    rankingMode: "balanced",
    themeMode: "dark",
    accentColor: "#CEAA34",
  };
  const base = {
    mediaType: "movie",
    titleKind: "movie",
    year: 2005,
    overview: "A sample synopsis for the isolated UI check.",
    posterPath: null,
    backdropPath: null,
    releaseDate: "2005-01-01",
    genreIds: [1],
    originalLanguage: "en",
    languages: ["en"],
    popularity: 100,
    voteAverage: 8.3,
    voteCount: 750000,
    adult: false,
    runtime: 120,
    certification: "R",
    directorIds: [],
    directorNames: [],
    castIds: [],
    castNames: [],
    match: 92,
    reasons: [],
  };
  const movies = Array.from({ length: 1000 }, (_, index) => ({
    ...base,
    imdbId: `tt${1000000 + index}`,
    title: index === 6 ? "A".repeat(200) : `Sample Title ${index}`,
  }));
  let library = movies.map((movie) => ({
    ...movie,
    status: "watched",
    rating: 8,
    updatedAt: "2026-10-01T00:00:00Z",
  }));
  let history = [
    {
      id: "saved-1",
      savedAt: "2026-10-01",
      titleKind: "movie",
      genres: [],
      yearMin: 2000,
      yearMax: 2026,
      ratingMin: 7,
      sortBy: "match",
    },
  ];
  history.push({
    id: "saved-2",
    savedAt: "2026-10-02",
    titleKind: "tv",
    genres: [{ id: 2, name: "Drama" }],
    yearMin: 1990,
    yearMax: 2010,
    ratingMin: 8,
    sortBy: "vote_average.desc",
    filters: {
      query: "Saved series",
      titleKind: "tv",
      genres: [2],
      withoutGenres: [1],
      excludeLanguages: ["fr"],
      yearMin: 1990,
      yearMax: 2010,
      ratingMin: 8,
      ratingMax: 10,
      voteCountMin: 2000,
      runtimeMin: 30,
      runtimeMax: 90,
      sortBy: "vote_average.desc",
      hideWatched: false,
      hideWatchlist: true,
    },
  });
  const profile = { ready: true, topGenres: [], ratedCount: 1000 };
  const delay = () => new Promise((resolve) => setTimeout(resolve, 120));
  window.api = {
    getSettings: async () => settings,
    setSettings: async (patch) => {
      control.settingsWrites++;
      await delay();
      if (control.failSave) throw new Error("Fixture save error");
      return (settings = { ...settings, ...patch });
    },
    listLibrary: async () => library,
    genres: async () => [
      { id: 1, name: "Crime" },
      { id: 2, name: "Drama" },
    ],
    profile: async () => profile,
    catalogStatus: async () => control.status,
    onCatalogStatus: (handler) => {
      control.catalogListeners.add(handler);
      return () => control.catalogListeners.delete(handler);
    },
    onImportProgress: (handler) => {
      control.importHandler = handler;
      return () => {
        control.importHandler = null;
      };
    },
    listSearchHistory: async () => history,
    saveSearchHistory: async () => {
      control.historyWrites++;
      return history;
    },
    removeSearchHistory: async (id) =>
      (history = history.filter((item) => item.id !== id)),
    discover: async (filters) => {
      control.discoverCalls++;
      control.lastFilters = filters;
      await new Promise((resolve) => setTimeout(resolve, control.searchDelay));
      const offset = Number(filters.cursor || 0);
      return {
        results: movies.slice(offset, offset + 200),
        totalResults: 1000,
        nextCursor: String(offset + 200),
        canLoadMore: offset + 200 < 1000,
      };
    },
    movie: async (id) => ({
      ...movies.find((movie) => movie.imdbId === id),
      genres: [{ id: 1, name: "Crime" }],
      directors: [],
      cast: [
        {
          id: 1,
          name: "A long cast name to check wrapping",
          character: "A long character name",
          profilePath: "/fixture.jpg",
        },
      ],
    }),
    fillMedia: async (ids) =>
      ids.map((id) => ({
        id,
        synopsis: base.overview,
        posterUrl:
          control.posterStates && id === "tt1000001"
            ? ""
            : control.posterStates && id === "tt1000002"
              ? "/fixture.jpg"
              : null,
        certification: "R",
        hydrationComplete: true,
      })),
    forYou: async () => {
      await delay();
      return {
        movies: movies.slice(0, 80).map((movie, index) => ({
          ...movie,
          imdbId: `tt${9000000 + index}`,
        })),
        profile,
        insights: [],
      };
    },
    removeLibrary: async (id) => {
      await delay();
      if (control.failRemove) throw new Error("Fixture remove error");
      library = library.filter((row) => row.imdbId !== id);
      return library;
    },
    upsertLibrary: async ({ movie, status, rating }) => {
      await delay();
      if (control.failUpsert) throw new Error("Fixture upsert error");
      library = [
        ...library.filter((row) => row.imdbId !== movie.imdbId),
        { ...movie, status, rating, updatedAt: "2026-10-01T00:00:00Z" },
      ];
      return library;
    },
    backgroundService: {
      getStatus: async () => ({
        supported: false,
        state: "running",
        logsAvailable: true,
        message: "Running",
      }),
    },
    clearLibrary: async () => (library = []),
    tmdbHealth: async () => {
      if (control.healthMode === "error") throw new Error("Coverage timed out");
      if (control.healthMode === "zero")
        return { total: 0, posters: 0, synopses: 0, certifications: 0 };
      if (control.healthMode === "complete")
        return {
          total: 1000,
          posters: 1000,
          synopses: 1000,
          certifications: 1000,
        };
      return {
        total: 1000,
        posters: 500,
        synopses: 700,
        certifications: 400,
      };
    },
  };
});

try {
  // Prevent fixture image traffic from reaching a real catalogue or remote host.
  await page.route("**/fixture.jpg", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto(server.resolvedUrls.local[0]);
  await page
    .getByRole("checkbox", { name: "Hide watched", exact: true })
    .uncheck();
  await page.getByRole("heading", { name: "Sample Title 0 R" }).waitFor();
  const results = page.getByRole("list", { name: "Search results" });
  // Discover opens on the poster grid; the list-row checks below use List view.
  await page.getByRole("button", { name: "List view", exact: true }).click();
  assert.ok((await results.getByRole("listitem").count()) < 40);
  const rowWidths = await results
    .getByRole("button")
    .evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().width),
    );
  assert.ok(Math.max(...rowWidths) - Math.min(...rowWidths) < 1);
  check("Discover mounts only the visible subset of 200 loaded titles");

  const scroll = page.locator("#discover-results-scroll");
  await scroll.evaluate(
    (element) => (element.scrollTop = element.scrollHeight),
  );
  await page.waitForFunction(() => window.__uiTest.discoverCalls >= 2);
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '[role="list"][aria-label="Search results"] [role="listitem"]',
        )
        ?.getAttribute("aria-setsize") === "400",
  );
  await scroll.evaluate(
    (element) => (element.scrollTop = element.scrollHeight),
  );
  await results.getByRole("listitem").first().waitFor();
  assert.ok((await results.getByRole("listitem").count()) < 40);
  check("Infinite loading still appends pages with bounded DOM rows");

  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await scroll.evaluate((element) => (element.scrollTop = 0));
  await results.getByRole("button", { name: /Sample Title 0 / }).waitFor();
  assert.ok((await results.getByRole("listitem").count()) < 100);
  check("Grid layout virtualizes measured rows");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await results.getByRole("button", { name: /Sample Title 0 / }).focus();
  for (let index = 0; index < 35; index++) await page.keyboard.press("Tab");
  assert.ok(
    (await page.locator(":focus").textContent()).includes("Sample Title 35"),
  );
  check("Tab navigation crosses virtualized row boundaries");

  const history = page.getByRole("button", { name: "Search history" });
  await history.focus();
  await page.keyboard.press("Enter");
  const historyDialog = page.getByRole("dialog", { name: "Search history" });
  await historyDialog.waitFor();
  assert.equal(
    await historyDialog
      .locator("button")
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  assert.equal(
    await history.evaluate((el) => el === document.activeElement),
    true,
  );
  check("History popover focuses its first action and restores trigger focus");

  await history.press("Enter");
  await historyDialog.waitFor();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await history.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await historyDialog.count(), 0);
  await history.press("Enter");
  await historyDialog.waitFor();
  await historyDialog.locator("button").last().focus();
  await page.keyboard.press("Tab");
  assert.equal(await historyDialog.count(), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement !== document.body),
    true,
  );
  check("Tab and Shift+Tab leave the history popover without losing focus");

  const inspector = page.getByRole("complementary", { name: "Title details" });
  const retainedScroll = await scroll.evaluate((element) => element.scrollTop);
  await inspector.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await inspector.getByRole("radio", { name: "8 out of 10" }).waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="radio"][aria-label="8 out of 10"]')
        ?.getAttribute("aria-checked") === "true",
  );
  assert.equal(
    await inspector
      .getByRole("button", { name: "Watched", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  check("Inspector removal Undo restores rating and watched status");
  assert.ok(
    Math.abs(
      (await scroll.evaluate((element) => element.scrollTop)) - retainedScroll,
    ) < 100,
  );
  check("Library revisions retain loaded Search pages and scroll position");

  await page.evaluate(() => (window.__uiTest.failRemove = true));
  await inspector.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not remove" })
    .waitFor();
  assert.equal(
    await inspector
      .getByRole("button", { name: "Watched", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => (window.__uiTest.failRemove = false));
  check("Failed removal leaves the existing entry and announces recovery");

  await page.getByRole("button", { name: "Library", exact: true }).click();
  const library = page.getByRole("list", { name: "Library titles" });
  await library.waitFor();
  assert.ok((await library.getByRole("listitem").count()) < 40);
  await library
    .getByRole("button", {
      name: "Remove Sample Title 1 from library",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(async () =>
    (await window.api.listLibrary()).some(
      (row) =>
        row.imdbId === "tt1000001" &&
        row.rating === 8 &&
        row.status === "watched",
    ),
  );
  await page
    .getByRole("status")
    .filter({ hasText: "Sample Title 1 restored" })
    .waitFor();
  check("Library virtualizes 1000 entries and shares removal Undo");

  await page.getByRole("button", { name: "For you", exact: true }).click();
  await page
    .getByRole("list", { name: "Ranked titles" })
    .getByRole("listitem")
    .first()
    .waitFor();
  assert.ok(
    (await page
      .getByRole("list", { name: "Ranked titles" })
      .getByRole("listitem")
      .count()) < 40,
  );
  check("For You virtualizes the ranking list");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Region", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "IMDb ratings API", exact: true })
      .count(),
    0,
  );
  check("Unsupported settings are absent");
  const catalogUrl = page.getByRole("textbox", {
    name: "Catalog API URL",
    exact: true,
  });
  await catalogUrl.fill("http://127.0.0.1:4848");
  const rankingMode = page.getByRole("button", {
    name: "Ranking mode",
    exact: true,
  });
  await rankingMode.click();
  await page
    .getByRole("option", {
      name: "Surprise me — downrank genres you just watched",
      exact: true,
    })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.waitForFunction(
    () => !document.querySelector("fieldset")?.disabled,
  );
  assert.equal(await catalogUrl.inputValue(), "http://127.0.0.1:4848");
  assert.match(await rankingMode.textContent(), /Surprise me/);
  assert.equal(
    await page
      .getByRole("radio", { name: "Light", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  check("Theme arrow navigation preserves the unsaved catalogue URL draft");

  const accent = page.getByRole("textbox", {
    name: "Accent color hex",
    exact: true,
  });
  await accent.fill("");
  const beforeAccent = await page.evaluate(
    () => window.__uiTest.settingsWrites,
  );
  await accent.pressSequentially("#2659A2", { delay: 20 });
  assert.equal(await accent.inputValue(), "#2659A2");
  assert.equal(
    await page.evaluate(() => window.__uiTest.settingsWrites),
    beforeAccent,
  );
  await accent.press("Enter");
  await page.waitForFunction(
    async () => (await window.api.getSettings()).accentColor === "#2659A2",
  );
  await page.waitForFunction(
    () => !document.querySelector("fieldset")?.disabled,
  );
  assert.equal(await catalogUrl.inputValue(), "http://127.0.0.1:4848");
  await accent.fill("#CEAA34");
  await accent.press("Enter");
  await page.waitForFunction(
    async () => (await window.api.getSettings()).accentColor === "#CEAA34",
  );
  await page.waitForFunction(
    () => !document.querySelector("fieldset")?.disabled,
  );
  await page.waitForFunction(
    () =>
      document.documentElement.style.getPropertyValue("--imd-accent") ===
      "#CEAA34",
  );
  check(
    "Hex accent editing accepts all digits before saving and preserves ranking drafts",
  );

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Library", exact: true }).click();
  assert.equal(await catalogUrl.inputValue(), "http://127.0.0.1:4848");
  const unloadBlocked = await page.evaluate(
    () =>
      !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  assert.equal(unloadBlocked, true);
  check("Unsaved settings guard both navigation and unload");

  await catalogUrl.fill("localhost");
  const before = await page.evaluate(() => window.__uiTest.settingsWrites);
  await page
    .getByRole("button", { name: "Save Settings", exact: true })
    .click();
  assert.equal(await catalogUrl.getAttribute("aria-invalid"), "true");
  assert.equal(
    await catalogUrl.evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.__uiTest.settingsWrites),
    before,
  );
  check("Invalid fields are explained inline and focused before any write");

  await catalogUrl.fill("http://127.0.0.1:4848");
  await page.evaluate(() => (window.__uiTest.failSave = true));
  await page
    .getByRole("button", { name: "Save Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not save settings" })
    .waitFor();
  assert.equal(await catalogUrl.inputValue(), "http://127.0.0.1:4848");
  await page.evaluate(() => (window.__uiTest.failSave = false));
  await page
    .getByRole("button", { name: "Save Settings", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Settings saved." })
    .waitFor();
  check("Saving feedback, failure recovery, and successful persistence");

  await page.evaluate(() =>
    window.__uiTest.importHandler({
      current: 4,
      total: 10,
      imported: 4,
      skipped: 0,
      errors: 0,
      title: "Sample import",
    }),
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Ratings import" })
      .getAttribute("aria-valuenow"),
    "4",
  );
  check("Import progress has a labelled accessible value and live status");

  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await results.getByRole("listitem").first().waitFor();
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("radio", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => !document.querySelector("fieldset")?.disabled,
    );
    await page.getByRole("button", { name: "Discover", exact: true }).click();
    await results.getByRole("listitem").first().waitFor();
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((animation) => animation.playState === "finished"),
    );
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--imd-accent"),
      ),
      "#CEAA34",
    );
    const contrasts = await page.evaluate(() => {
      const parse = (s) => s.match(/[\d.]+/g).map(Number);
      const canvas = parse(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--imd-canvas")
          .trim()
          .startsWith("#")
          ? (() => {
              const hex = getComputedStyle(document.documentElement)
                .getPropertyValue("--imd-canvas")
                .trim();
              return `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")})`;
            })()
          : "rgb(14,14,16)",
      );
      const luminance = (c) =>
        c
          .slice(0, 3)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (fg, bg) => {
        const a = luminance(fg),
          b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const measure = (el) => {
        const style = getComputedStyle(el);
        const bg = parse(style.backgroundColor);
        const alpha = bg[3] ?? 1;
        return ratio(
          parse(style.color),
          bg.slice(0, 3).map((v, i) => v * alpha + canvas[i] * (1 - alpha)),
        );
      };
      return [
        measure(document.querySelector('[aria-label="8 out of 10"]')),
        measure(document.querySelector('[aria-label="9 out of 10"]')),
        measure(document.querySelector(".text-faint")),
        measure(
          document.querySelector(
            '[aria-label="Primary"] [aria-current="page"]',
          ),
        ),
        measure(
          document.querySelector(
            '[aria-label="Title details"] .text-accent-text',
          ),
        ),
      ];
    });
    assert.ok(
      contrasts.every((value) => value >= 4.5),
      `${theme}: ${contrasts}`,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(output, `${theme}-1440.png`) });
    await page.setViewportSize({ width: 1100, height: 720 });
    const narrow = await inspector.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const poster = el.firstElementChild.getBoundingClientRect();
      const actions = [...el.querySelectorAll("button")].filter((button) =>
        ["Watched", "Watchlist", "Not for me"].includes(button.textContent),
      );
      return {
        posterHeight: poster.height,
        inspectorHeight: bounds.height,
        actionsVisible: actions.every(
          (button) => button.getBoundingClientRect().bottom <= bounds.bottom,
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(
      narrow.posterHeight < 150 && narrow.actionsVisible && !narrow.overflow,
      JSON.stringify(narrow),
    );
    await page.screenshot({ path: join(output, `${theme}-1100.png`) });
    await page.setViewportSize({ width: 1440, height: 920 });
  }
  check(
    "Both themes meet text contrast and keep inspector actions visible at minimum size",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page
    .locator(".animate-fade")
    .evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(motion, "none");
  check("Reduced motion disables animated content");
  await page.keyboard.press("Control+Home");
  await page.getByRole("link", { name: "Skip to Content" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("main").evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await page.locator("h1").count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Discover", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  check("Skip link, primary heading, and current navigation semantics");
  // Targeted regressions for launch, loading layout, History replay and metadata states.
  await page.goto(`${server.resolvedUrls.local[0]}?loading=1`);
  const overlay = page.locator("[data-loading-overlay]");
  await overlay.waitFor();
  async function assertCentered(locator) {
    const centers = await locator.evaluate((el) => {
      const p = el.querySelector("p").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const content = [...el.children].map((child) =>
        child.getBoundingClientRect(),
      );
      return {
        dx: Math.abs(p.x + p.width / 2 - (r.x + r.width / 2)),
        dy: Math.abs(
          (content[0].top + content.at(-1).bottom) / 2 - (r.y + r.height / 2),
        ),
        height: r.height,
      };
    });
    assert.ok(
      centers.dx < 2 && centers.dy < 3 && centers.height > 200,
      JSON.stringify(centers),
    );
  }
  await assertCentered(overlay);
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    const spinner = page.locator(".animate-catalog");
    const before = await spinner.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    await page.waitForTimeout(180);
    const after = await spinner.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    assert.notEqual(before, after);
    await page.screenshot({
      path: join(output, `loading-${reducedMotion}.png`),
    });
  }
  check("Launch loader is centered and spins with normal and reduced motion");
  await page.evaluate(() => {
    const c = window.__uiTest;
    c.posterStates = true;
    c.searchDelay = 900;
    c.status = {
      ...c.status,
      phase: "ready",
      catalogUsable: true,
      tmdbHydration: {
        total: 1000,
        complete: true,
        message: "TMDb lookups complete. Posters: 500/1000",
      },
    };
    for (const listener of c.catalogListeners) listener(c.status);
  });
  await page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
  await assertCentered(overlay);
  await page
    .getByRole("checkbox", { name: "Hide watched", exact: true })
    .uncheck();
  await page.getByRole("heading", { name: "Sample Title 0 R" }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  assert.equal(
    await page.getByText("TMDb lookups complete", { exact: false }).count(),
    0,
  );
  await page.locator('[data-poster-status="unavailable"]').first().waitFor();
  assert.ok(await page.locator('[data-poster-status="pending"]').count());
  await page.locator('[data-poster-status="error"]').first().waitFor();
  await page.screenshot({ path: join(output, "search-poster-states.png") });
  check(
    "Search loader is centered; banner is removed; pending, missing and failed poster states differ",
  );
  await page
    .locator('input[name="titleQuery"]')
    .fill("unrelated current search");
  await page.waitForFunction(
    () => window.__uiTest.lastFilters?.query === "unrelated current search",
  );
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  const historyBefore = await page.evaluate(() => ({
    calls: window.__uiTest.discoverCalls,
    writes: window.__uiTest.historyWrites,
  }));
  await page
    .getByRole("button", { name: "Search history", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Search history" })
    .locator("button")
    .first()
    .click();
  await page.waitForFunction(() => window.__uiTest.lastFilters?.query === "");
  assert.equal(await page.locator('input[name="titleQuery"]').inputValue(), "");
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  const historyAfter = await page.evaluate(() => ({
    calls: window.__uiTest.discoverCalls,
    writes: window.__uiTest.historyWrites,
  }));
  assert.ok(historyAfter.calls > historyBefore.calls);
  assert.equal(historyAfter.writes, historyBefore.writes);
  await page
    .getByRole("button", { name: "Search history", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Search history" })
    .locator("button")
    .first()
    .click();
  await page.waitForFunction(
    (calls) => window.__uiTest.discoverCalls > calls,
    historyAfter.calls,
  );
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  assert.equal(
    await page.evaluate(() => window.__uiTest.historyWrites),
    historyBefore.writes,
  );
  check(
    "History mouse selection restores the form, searches even when unchanged and never re-records replay",
  );
  await page
    .getByRole("button", { name: "Search history", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Search history" })
    .getByRole("button")
    .filter({ hasText: "Saved series" })
    .click();
  await page.waitForFunction(
    () => window.__uiTest.lastFilters?.query === "Saved series",
  );
  assert.equal(
    await page.locator('input[name="titleQuery"]').inputValue(),
    "Saved series",
  );
  const restored = await page.evaluate(() => window.__uiTest.lastFilters);
  assert.equal(restored.titleKind, "tv");
  assert.deepEqual(restored.genres, [2]);
  assert.deepEqual(restored.withoutGenres, [1]);
  assert.deepEqual(restored.excludeLanguages, ["fr"]);
  assert.equal(restored.voteCountMin, 2000);
  assert.equal(restored.runtimeMin, 30);
  assert.equal(restored.hideWatchlist, true);
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  assert.equal(
    await page.evaluate(() => window.__uiTest.historyWrites),
    historyBefore.writes,
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.waitForFunction(
    () => window.__uiTest.lastFilters?.query === "Saved series",
  );
  await page.waitForFunction(
    () => !document.querySelector("[data-loading-overlay]"),
  );
  assert.equal(
    await page.evaluate(() => window.__uiTest.historyWrites),
    historyBefore.writes,
  );
  check(
    "Full History entries restore every criterion and stay unrecorded after leaving and reopening Search",
  );
  for (const name of ["For you", "Library", "Settings"]) {
    await page.getByRole("button", { name, exact: true }).click();
    assert.equal(
      await page.getByRole("complementary", { name: "Title details" }).count(),
      0,
    );
  }
  check("Title preview is absent from For You, Library and Settings");
  const bars = page.getByRole("progressbar");
  await page.evaluate(() => (window.__uiTest.healthMode = "complete"));
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="progressbar"][aria-label="Posters"]')
        ?.getAttribute("aria-valuenow") === "100",
  );
  assert.equal(await bars.count(), 3);
  await page.evaluate(() => (window.__uiTest.healthMode = "error"));
  await page
    .getByText("Coverage update unavailable. Showing the last measurement.")
    .waitFor();
  assert.equal(await bars.count(), 3);
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Posters", exact: true })
      .getAttribute("aria-valuenow"),
    "100",
  );
  await page.screenshot({ path: join(output, "settings-coverage.png") });
  await page.evaluate(() => (window.__uiTest.healthMode = "zero"));
  await page.getByText("No titles to measure yet.").waitFor();
  assert.equal(await bars.count(), 3);
  const buttonStyle = await page
    .getByRole("button", { name: "Rebuild catalog", exact: true })
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        font: parseFloat(s.fontSize),
        height: el.getBoundingClientRect().height,
        radius: parseFloat(s.borderRadius),
        gap:
          el.getBoundingClientRect().top -
          el.previousElementSibling.getBoundingClientRect().bottom,
      };
    });
  assert.ok(
    buttonStyle.font <= 12 &&
      buttonStyle.height <= 34 &&
      buttonStyle.radius <= 6 &&
      buttonStyle.gap >= 12,
    JSON.stringify(buttonStyle),
  );
  check(
    "Coverage bars persist at 100%, after failed polls and at zero; Settings buttons are compact and spaced",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Clear library", exact: true })
    .click();
  await page.getByText("Library cleared.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const empty = page.getByText("Nothing in this shelf yet", { exact: true });
  await empty.waitFor();
  assert.equal(
    await empty.evaluate((el) => getComputedStyle(el).fontSize),
    "13px",
  );
  await assertCentered(overlay);
  await page.screenshot({ path: join(output, "library-empty.png") });
  check("Empty shelf uses the compact centered completion overlay");
  assert.deepEqual(runtimeErrors, []);
  check("No renderer runtime exceptions");
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ checks, runtimeErrors }, null, 2),
  );
  console.log(`Evidence: ${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") });
  await writeFile(join(output, "failure.html"), await page.content());
  console.log(
    await page.evaluate(() => ({
      focus: document.activeElement?.outerHTML.slice(0, 500),
      scrollers: [...document.querySelectorAll('[role="region"]')].map(
        (el) => ({
          top: el.scrollTop,
          height: el.scrollHeight,
          client: el.clientHeight,
        }),
      ),
      items: [...document.querySelectorAll('[role="listitem"]')].map((el) =>
        el.getAttribute("aria-posinset"),
      ),
    })),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
