# Catalogue Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make credits readiness, Discover's next page, the movie mapping, and catalogue settle each have one place that tests can hit, without changing when the shell blocks.

**Architecture:** Six phases, each shippable alone. Credits readiness becomes the meta flag only. The unreachable language-only hydration branch goes away because pending already includes languages. A catalogue title becomes one `MovieSummary`. Discover's query record, page size, and best-match re-rank of the new page sit in one module. The inline rebuild strip, which cannot render, is removed. Settle uses the probed port.

**Tech Stack:** TypeScript, Node `node:test` via `tsx`, better-sqlite3. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-catalogue-deepening.md`

## Global Constraints

- `creditsReady` is the `creditsReady` meta flag only. A `title_people` row does not count.
- `titlesReady` stays `titleCount > 0` and a stored `builtAt`.
- Title ingest and credits ingest stay separate calls.
- `TMDB_HYDRATION_PENDING_SQL` stays the pending rule, including `languages_checked`. `''` is a durable miss. Do not split the TMDb scheduler, key pool, or hydration coordinator.
- Kind rule: lowercased `kind`; `mini` → `miniseries`; else `tv` or `series` → `tv`; else `movie`. `mediaType` is `movie` only for title kind `movie`.
- `genreId` starts at 7, then `(hash * 31 + char) >>> 0` per lowercased character.
- Discover page size is 40 for both `pageSize` and `limit`. `ratingMax` is not sent. `includeTotal` is `"false"`. `match` sorts as `votes` on the wire.
- Best-match re-rank runs only when `sortBy` is `match` and rated count is at least 3, and only on the new page.
- Phase `building` blocks the shell even when `catalogUsable` is true. Do not change that.
- Settle: open port and a dead child resets; dead child, closed port, and 8 misses throws `Catalog API became unreachable.`; a live child does not give up on the settle path.
- Tests: `npm test --workspace=@rescore/api` and `npm test --workspace=rescore`. No new dependencies.

## Review Focus

- A partial credits write that inserted people and never set the flag must leave `creditsReady` false. Pinned in Task 1.
- The flag set with an empty `title_people` table must leave `creditsReady` true. Pinned in Task 1.
- Best-match re-rank must reorder only the page just fetched, not a list the caller already showed. Pinned in Task 5.
- `sortBy === "match"` with rated count 2 must leave catalogue order. Pinned in Task 5.
- Settle at 8 misses with a dead child and an open port must reset, not throw. Pinned in Task 7.

---

## File structure

- `apps/api/src/catalog/meta.ts` — `readiness` reads the credits flag only.
- `apps/api/src/catalog/catalog.test.ts` — overlay person and partial people do not set the flag.
- `apps/api/src/services/tmdb-posters.ts` — delete the unreachable language-only branch.
- `apps/desktop/src/shared/movie.ts` — `genreId` and `movieFromTitle`.
- `apps/desktop/src/shared/movie.test.ts` — kind, null rating, blank certification, hash.
- `apps/desktop/src/main/catalog-client.ts` — `toSummary` calls `movieFromTitle`. `discoverQuery` calls `discoverQueryParams`.
- `apps/desktop/src/main/ipc.ts` — For You mapping calls `movieFromTitle`. `discover` calls `loadDiscoverSlice`.
- `apps/desktop/src/main/discover-slice.ts` — page size, query record, next-slice result.
- `apps/desktop/src/main/discover-slice.test.ts` — query record and slice behavior.
- `apps/desktop/src/main/discover-paging.ts` — deleted in Task 5. Its tests move onto the slice.
- `apps/desktop/src/renderer/src/views/Discover.tsx` — reads `canLoadMore` from the result.
- `apps/desktop/src/renderer/src/App.tsx` — delete the unreachable inline strip.
- `apps/desktop/src/main/api-watch.ts` — `settleHealthMiss`.
- `apps/desktop/src/main/api-watch.test.ts` — port open resets; closed port gives up at 8.
- `apps/desktop/src/main/catalog-runtime.ts` — `pollUntilSettled` calls `settleHealthMiss` with the probed port.
- `apps/desktop/src/shared/ranking-types.ts` — `PagedMovies.canLoadMore`.

## Phase 1 — Credits flag

### Task 1: Credits readiness is the flag

**Files:**
- Modify: `apps/api/src/catalog/meta.ts` (`readiness`)
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogDatabase.upsertTitles`, `insertPeople`, `setCatalogMeta`, `setCreditsReady`, `titlesReady`, `creditsReady`
- Produces: `creditsReady()` is true only after `setCreditsReady(true)`

- [x] **Step 1: Write the failing test**

Add to `apps/api/src/catalog/catalog.test.ts`:

```ts
test("people rows do not mark credits ready", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    {
      id: "tt0133093",
      title: "The Matrix",
      directors: ["Lana Wachowski"],
      cast: ["Keanu Reeves"],
    },
  ]);
  catalog.setCatalogMeta({
    builtAt: "2026-10-03T00:00:00.000Z",
    revision: "test",
    source: "test",
  });
  assert.equal(catalog.titlesReady(), true);
  assert.equal(catalog.creditsReady(), false);

  catalog.insertPeople([
    {
      titleId: "tt0133093",
      nconst: "nm0905154",
      name: "Lilly Wachowski",
      role: "director",
      position: 1,
    },
  ]);
  assert.equal(catalog.creditsReady(), false);

  catalog.setCreditsReady(true);
  assert.equal(catalog.creditsReady(), true);
  catalog.close();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- --test-name-pattern "people rows do not mark credits ready"`

Expected: FAIL because `creditsReady()` is true after `upsertTitles` writes `title_people`.

- [x] **Step 3: Change `readiness` in `apps/api/src/catalog/meta.ts`**

`creditsReady` is `flagIsSet(db, "creditsReady")` only. Delete the `title_people` fallback. Leave `titlesReady` as it is.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@rescore/api -- --test-name-pattern "people rows do not mark credits ready"`

Expected: PASS. Also run `npm test --workspace=@rescore/api -- --test-name-pattern "titles are ready without credits"`. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/catalog/meta.ts apps/api/src/catalog/catalog.test.ts
git commit -m "$(cat <<'EOF'
fix: treat credits as ready only when the flag is set

EOF
)"
```

## Phase 2 — Overlay branch

### Task 2: Delete the unreachable language-only hydration branch

**Files:**
- Modify: `apps/api/src/services/tmdb-posters.ts` (`hydrate`, `execute`)
- Test: existing `apps/api/src/catalog/catalog.test.ts` and `apps/api/src/services/tmdb-posters.test.ts`

**Interfaces:**
- Consumes: `CatalogDatabase.titleNeedsMedia` (already includes `languages_checked`)
- Produces: `TmdbHydrationCoordinator.hydrate` returns true without queueing when `!titleNeedsMedia(id)`. `execute` writes `findTitleMedia`'s result, including `languages`, in that single branch. Job `complete` is `!titleNeedsMedia(id)`.

- [x] **Step 1: Confirm the pending rule already treats unchecked languages as pending**

Run: `npm test --workspace=@rescore/api -- --test-name-pattern "complete media still leaves a title pending until languages are checked"`

Expected: PASS. If it fails, stop. Do not delete the branch.

- [x] **Step 2: Remove the language-only branch**

In `hydrate`, return `Promise.resolve(true)` when `!catalog.titleNeedsMedia(id)`. Delete the `titleNeedsLanguages` call there.

In `execute`, delete the `else if (job.catalog.titleNeedsLanguages(...))` branch. Keep the `titleNeedsMedia` branch that queues `{ id, ...media }`. Set `complete` to `!job.catalog.titleNeedsMedia(job.id)` only.

Do not delete `CatalogDatabase.titleNeedsLanguages`.

- [x] **Step 3: Run the poster and catalogue tests**

Run: `npm test --workspace=@rescore/api -- --test-name-pattern "complete media still leaves a title pending|tmdb hydration keeps confirmed misses|a finished title receives language"`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add apps/api/src/services/tmdb-posters.ts
git commit -m "$(cat <<'EOF'
fix: hydrate a title once when languages are still pending

EOF
)"
```

## Phase 3 — Movie

### Task 3: One movie from a catalogue title

**Files:**
- Modify: `apps/desktop/src/shared/movie.ts`
- Create: `apps/desktop/src/shared/movie.test.ts`
- Modify: `apps/desktop/src/main/catalog-client.ts` (`genreId`, `toSummary`)
- Modify: `apps/desktop/src/main/ipc.ts` (`toSummaryFromDto`, `genreId` import)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `genreId(name: string): number` exported from `apps/desktop/src/shared/movie.ts`
  - `movieFromTitle(title: CatalogueTitle): MovieSummary` in the same file
  - `CatalogueTitle` fields: `id`, `title`, `originalTitle`, `kind`, `year`, `runtimeMinutes`, `synopsis`, `posterUrl`, `certification`, `imdbRating`, `imdbVotes`, `genres`, `directors`, `cast`, optional `languages`

- [x] **Step 1: Write the failing test**

Create `apps/desktop/src/shared/movie.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { genreId, movieFromTitle } from "./movie";

const base = {
  id: "tt0133093",
  title: "The Matrix",
  originalTitle: "The Matrix",
  kind: "movie",
  year: 1999,
  runtimeMinutes: 136,
  synopsis: null,
  posterUrl: null,
  certification: "",
  imdbRating: null,
  imdbVotes: null,
  genres: ["Action"],
  directors: [],
  cast: [],
  languages: [],
};

test("movie from a catalogue title", () => {
  const movie = movieFromTitle(base);
  assert.equal(movie.imdbId, "tt0133093");
  assert.equal(movie.titleKind, "movie");
  assert.equal(movie.mediaType, "movie");
  assert.equal(movie.voteAverage, 0);
  assert.equal(movie.voteCount, 0);
  assert.equal(movie.overview, "");
  assert.equal(movie.certification, undefined);
  assert.deepEqual(movie.genreIds, [genreId("Action")]);

  assert.equal(movieFromTitle({ ...base, kind: "tvMiniSeries" }).titleKind, "miniseries");
  assert.equal(movieFromTitle({ ...base, kind: "tvSeries" }).titleKind, "tv");
  assert.equal(movieFromTitle({ ...base, kind: "tvSeries" }).mediaType, "tv");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=rescore -- --test-name-pattern "movie from a catalogue title"`

Expected: FAIL with `movieFromTitle` not exported.

- [x] **Step 3: Implement `movieFromTitle` and move `genreId`**

Move `genreId` from `apps/desktop/src/main/catalog-client.ts` into `apps/desktop/src/shared/movie.ts` unchanged. Implement `movieFromTitle` with the kind rule in Global Constraints. `toSummary` and `toSummaryFromDto` each become `return movieFromTitle(title)`. Update imports. `genreId` is no longer exported from `catalog-client.ts`.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=rescore -- --test-name-pattern "movie from a catalogue title"`

Expected: PASS. Then `npm run typecheck --workspace=rescore`. Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/movie.ts apps/desktop/src/shared/movie.test.ts apps/desktop/src/main/catalog-client.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
fix: map a catalogue title to one movie

EOF
)"
```

## Phase 4 — Discover slice

### Task 4: Discover query record

**Files:**
- Create: `apps/desktop/src/main/discover-slice.ts`
- Create: `apps/desktop/src/main/discover-slice.test.ts`
- Modify: `apps/desktop/src/main/catalog-client.ts` (`discoverQuery`)

**Interfaces:**
- Consumes: `DiscoverFilters`, `defaultFilters` from `apps/desktop/src/shared/filters.ts`; `languageQueryCodes` from `apps/desktop/src/shared/languages.ts`
- Produces:
  - `DISCOVER_PAGE_SIZE = 40`
  - `discoverQueryParams(filters: DiscoverFilters, names: { genres: string[]; withoutGenres: string[] }): Record<string, string | number | undefined>`

- [x] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "../shared/filters";
import { DISCOVER_PAGE_SIZE, discoverQueryParams } from "./discover-slice";

test("discover query omits the rating ceiling and fixes the page size", () => {
  const params = discoverQueryParams(
    { ...defaultFilters(), ratingMin: 0, voteCountMin: 0, sortBy: "match", cursor: "abc" },
    { genres: ["Action"], withoutGenres: [] },
  );
  assert.equal(DISCOVER_PAGE_SIZE, 40);
  assert.equal(params.pageSize, 40);
  assert.equal(params.limit, 40);
  assert.equal(params.includeTotal, "false");
  assert.equal(params.sort, "votes");
  assert.equal(params.cursor, "abc");
  assert.equal(params.genre, "Action");
  assert.equal("ratingMax" in params, false);
  assert.equal("ratingMin" in params, false);
  assert.equal("votesMin" in params, false);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=rescore -- --test-name-pattern "discover query omits the rating ceiling"`

Expected: FAIL with `discoverQueryParams` not exported.

- [x] **Step 3: Move the query mapping**

Create `discover-slice.ts`. Move `sortFor` and `orderFor` from `catalog-client.ts` unchanged. `discoverQueryParams` returns the same record `discoverQuery` returns today, using `DISCOVER_PAGE_SIZE` for both size fields, and it does not set `ratingMax`. `CatalogClient.discoverQuery` returns `discoverQueryParams(...)`.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=rescore -- --test-name-pattern "discover query omits the rating ceiling"`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/discover-slice.ts apps/desktop/src/main/discover-slice.test.ts apps/desktop/src/main/catalog-client.ts
git commit -m "$(cat <<'EOF'
fix: build the Discover query in one place

EOF
)"
```

### Task 5: Next Discover slice

**Files:**
- Modify: `apps/desktop/src/main/discover-slice.ts`
- Modify: `apps/desktop/src/main/discover-slice.test.ts`
- Modify: `apps/desktop/src/shared/ranking-types.ts` (`PagedMovies`)
- Modify: `apps/desktop/src/main/catalog-client.ts` (`discover` sets `canLoadMore`)
- Modify: `apps/desktop/src/main/ipc.ts` (`discover`)
- Modify: `apps/desktop/src/renderer/src/views/Discover.tsx`
- Delete: `apps/desktop/src/main/discover-paging.ts`
- Delete: `apps/desktop/src/main/discover-paging.test.ts`

**Interfaces:**
- Consumes: `DISCOVER_PAGE_SIZE` from Task 4. `PagedMovies` and `RankedMovie` from `ranking-types.ts`. `scoreMovie` / `sortMovies` stay in `ipc.ts` and are passed in as `rankPage`.
- Produces:
  - `PagedMovies.canLoadMore: boolean`
  - `loadDiscoverSlice(input: { filters: DiscoverFilters; mode: "replace" | "append"; cursor: string | null; ratedCount: number; fetchPage: (filters: DiscoverFilters) => Promise<PagedMovies>; rankPage: (movies: RankedMovie[]) => RankedMovie[] }): Promise<PagedMovies>`

- [x] **Step 1: Write the failing tests**

Append to `discover-slice.test.ts`. Helper, local to the test file:

```ts
function summary(imdbId: string): RankedMovie {
  return {
    imdbId,
    mediaType: "movie",
    titleKind: "movie",
    title: imdbId,
    overview: "",
    posterPath: null,
    backdropPath: null,
    releaseDate: "",
    genreIds: [],
    originalLanguage: "",
    popularity: 0,
    voteAverage: 0,
    voteCount: 0,
    adult: false,
    match: 0,
    reasons: [],
  };
}
```

```ts
test("replace clears the cursor and match re-rank touches only the new page", async () => {
  let received: string | null = "unset";
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "match" },
    mode: "replace",
    cursor: "old",
    ratedCount: 3,
    fetchPage: async (filters) => {
      received = filters.cursor ?? null;
      return {
        page: 1,
        totalPages: 2,
        totalResults: 80,
        results: [summary("tt1"), summary("tt2")],
        nextCursor: "next",
        canLoadMore: false,
      };
    },
    rankPage: (movies) => [...movies].reverse(),
  });
  assert.equal(received, null);
  assert.deepEqual(page.results.map((movie) => movie.imdbId), ["tt2", "tt1"]);
  assert.equal(page.nextCursor, "next");
  assert.equal(page.canLoadMore, false);
});

test("match under three rated titles keeps catalogue order", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "match" },
    mode: "append",
    cursor: "keep",
    ratedCount: 2,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [summary("tt1")],
      nextCursor: null,
      canLoadMore: false,
    }),
    rankPage: () => {
      throw new Error("rankPage must not run");
    },
  });
  assert.equal(page.results[0].imdbId, "tt1");
});

test("a full page with a cursor can load another", async () => {
  const results = Array.from({ length: 40 }, (_, index) => summary(`tt${index}`));
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 9,
    fetchPage: async (filters) => {
      assert.equal(filters.cursor, "cursor-value");
      return { page: 1, totalPages: 2, totalResults: 80, results, nextCursor: "next", canLoadMore: false };
    },
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, true);
  assert.equal(page.nextCursor, "next");
});

test("a short page is the end even with a cursor", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 0,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 12,
      results: Array.from({ length: 12 }, (_, index) => summary(`tt${index}`)),
      nextCursor: "cursor-value",
      canLoadMore: true,
    }),
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, false);
});

test("an exactly full last page does not request page one again", async () => {
  const page = await loadDiscoverSlice({
    filters: { ...defaultFilters(), sortBy: "vote_average.desc" },
    mode: "append",
    cursor: "cursor-value",
    ratedCount: 0,
    fetchPage: async () => ({
      page: 1,
      totalPages: 1,
      totalResults: 40,
      results: Array.from({ length: 40 }, (_, index) => summary(`tt${index}`)),
      nextCursor: null,
      canLoadMore: true,
    }),
    rankPage: (movies) => movies,
  });
  assert.equal(page.canLoadMore, false);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=rescore -- --test-name-pattern "replace clears the cursor|match under three|full page with a cursor"`

Expected: FAIL with `loadDiscoverSlice` not exported.

- [x] **Step 3: Implement `loadDiscoverSlice` and wire it**

`replace` sets `filters.cursor` to null before `fetchPage`. `append` sets `filters.cursor` to `cursor`. Always set `filters.page` to 1. Call `rankPage` only when `filters.sortBy === "match"` and `ratedCount >= 3`. `canLoadMore` is `fetched.results.length >= DISCOVER_PAGE_SIZE && fetched.nextCursor !== null`, using the length before re-rank. Return the fetched page with `results` replaced when re-ranked, and with that `canLoadMore`.

Add `canLoadMore: boolean` to `PagedMovies`. `CatalogClient.discover` sets it with that same expression so the return type is satisfied. The `withCatalog` empty page in `ipc.ts` sets `canLoadMore: false`. `ipc.ts` `discover` calls `loadDiscoverSlice` and returns that. `mode` is `"replace"` when `filters.cursor` is null or missing, otherwise `"append"`. `cursor` is `filters.cursor ?? null`. `ratedCount` is the existing `buildProfile(...).ratedCount`, and when that profile is not loaded because `sortBy !== "match"`, pass `0`. `rankPage` is the existing `scoreMovie` / `sortMovies` block. Do not add a mode argument to preload.

The view sets `lastPageFullRef` from `data.canLoadMore`. Delete `discover-paging.ts` and its test. Remove the view's import of `canLoadMoreFromPage` and the literal `40`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=rescore -- --test-name-pattern "replace clears the cursor|match under three|full page with a cursor|short page|exactly full last page"`

Expected: PASS. Then `npm run typecheck --workspace=rescore`. Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/discover-slice.ts apps/desktop/src/main/discover-slice.test.ts apps/desktop/src/shared/ranking-types.ts apps/desktop/src/main/catalog-client.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/src/views/Discover.tsx apps/desktop/src/main/discover-paging.ts apps/desktop/src/main/discover-paging.test.ts
git commit -m "$(cat <<'EOF'
fix: decide the next Discover page in one place

EOF
)"
```

## Phase 5 — Shell strip

### Task 6: Remove the unreachable inline rebuild strip

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (the `!catalogBusy && rebuildFeedback` block)
- Test: `apps/desktop/src/renderer/src/lib/catalog-busy.test.ts`

**Interfaces:**
- Consumes: `isCatalogUiBlocked`, `catalogRebuildFeedback`
- Produces: no new function. Settings still calls `catalogRebuildFeedback`.

- [x] **Step 1: Lock the invariant**

Add to `catalog-busy.test.ts`:

```ts
test("a blocked rebuild does not have an inline strip", () => {
  const status = {
    phase: "building",
    catalogUsable: true,
    message: "Rebuilding catalog from IMDb datasets…",
  };
  assert.equal(isCatalogUiBlocked(status), true);
  assert.equal(
    catalogRebuildFeedback(status)?.label,
    "Rebuilding catalog from IMDb datasets…",
  );
});
```

This passes before the JSX edit. It locks the product rule: building stays blocked, and Settings can still read the rebuild label.

- [x] **Step 2: Run the test**

Run: `npm test --workspace=rescore -- --test-name-pattern "a blocked rebuild does not have an inline strip"`

Expected: PASS.

- [x] **Step 3: Delete the strip**

In `App.tsx`, delete the block that renders `CatalogLoader` when `!catalogBusy && rebuildFeedback`. Leave the splash `CatalogLoader` and Settings as they are. If `rebuildFeedback` is then unused, delete that local too.

- [x] **Step 4: Run the catalogue-busy tests and typecheck**

Run: `npm test --workspace=rescore -- --test-name-pattern "blocked rebuild|settings rebuild blocks|rebuild feedback"`

Expected: PASS. Then `npm run typecheck --workspace=rescore`. Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/lib/catalog-busy.test.ts
git commit -m "$(cat <<'EOF'
fix: drop the rebuild strip that the splash already covers

EOF
)"
```

## Phase 6 — Settle

### Task 7: Settle uses the probed port

**Files:**
- Modify: `apps/desktop/src/main/api-watch.ts`
- Modify: `apps/desktop/src/main/api-watch.test.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts` (`pollUntilSettled`)

**Interfaces:**
- Consumes: `shouldSpawnReplacement`
- Produces: `settleHealthMiss(input: { childAlive: boolean; portOpen: boolean; missed: number }): "reset" | "wait" | "give-up"`

- [x] **Step 1: Write the failing test**

Add to `api-watch.test.ts`:

```ts
test("an open port resets settle instead of giving up", () => {
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: true, missed: 8 }),
    "reset",
  );
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: false, missed: 7 }),
    "wait",
  );
  assert.equal(
    settleHealthMiss({ childAlive: false, portOpen: false, missed: 8 }),
    "give-up",
  );
  assert.equal(
    settleHealthMiss({ childAlive: true, portOpen: false, missed: 8 }),
    "wait",
  );
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=rescore -- --test-name-pattern "an open port resets settle"`

Expected: FAIL with `settleHealthMiss` not exported.

- [x] **Step 3: Implement `settleHealthMiss` and call it from `pollUntilSettled`**

`portOpen && !childAlive` returns `"reset"`. `shouldSpawnReplacement(input) && missed >= 8` returns `"give-up"`. Otherwise `"wait"`.

In `pollUntilSettled`, replace the hand-written port continue and the `shouldSpawnReplacement({ childAlive, portOpen: false })` call with one `settleHealthMiss({ childAlive, portOpen: await portOpen(baseUrl), missed })`. `"reset"` sets `missed` to 0 and continues after the existing sleep. `"give-up"` throws `new Error("Catalog API became unreachable.")`. `"wait"` keeps the current publish-and-sleep path. Do not change `watchApi`.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=rescore -- --test-name-pattern "an open port resets settle|shouldSpawnReplacement|shouldRestartHungChild"`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/api-watch.ts apps/desktop/src/main/api-watch.test.ts apps/desktop/src/main/catalog-runtime.ts
git commit -m "$(cat <<'EOF'
fix: settle a dead catalogue child only when the port is closed

EOF
)"
```
