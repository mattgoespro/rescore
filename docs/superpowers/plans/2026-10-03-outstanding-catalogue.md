# Outstanding Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the rating ceiling in the catalogue, wrap title and credits writes, drop the unread TMDb usability input, and share poster-fill and catalogue-ownership decisions.

**Architecture:** Five phases, each shippable alone. The catalogue query gains `ratingMax` without dropping unrated titles. Rebuild start/finish/abort moves behind two functions. `isCatalogUsable` stops accepting `tmdbReady`. Poster fill backoff is one pure decision used by the list and the open title. Spawn versus refuse is one function used by launch and settings.

**Tech Stack:** TypeScript, Node `node:test` via `tsx`, better-sqlite3. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-outstanding-catalogue.md`

## Global Constraints

- `ratingMax` of 10 is not sent. A lower ceiling sends `ratingMax`. SQL is `(imdb_rating IS NULL OR imdb_rating <= @ratingMax)`.
- `ratingMin` stays omitted when 0.
- Title ingest and credits writing stay separate. Fingerprints and `queueAnalyze` stay outside the credits window.
- Credits flag is set only after `withCreditsWrite` succeeds.
- `isCatalogUsable` arguments are `titlesReady`, `creditsReady`, and optional `creditsFailed`. No `tmdbReady`.
- Phase `building` still blocks the shell.
- Poster fill limit is 40. Retry delay is 30_000 ms. `hydrationComplete === true` means resolved.
- Service owner: unreachable means refuse, and a catalogue URL change is refused. Desktop owner: unreachable means spawn, and the URL may change.
- Tests: `node --import tsx --test` from the workspace, because `npm test -- --test-name-pattern` does not filter reliably.

## Review Focus

- An unrated title stays listed when only `ratingMax` is set. Pinned in Task 1.
- A thrown credits write leaves `creditsReady` false. Pinned in Task 2.
- `tmdbReady` is not an `isCatalogUsable` argument. Pinned in Task 3.
- An id still inside its retry window is not filled again. Pinned in Task 4.
- A service-owned catalogue does not spawn. Pinned in Task 5.

---

### Task 1: Rating ceiling

**Files:**

- Modify: `apps/api/src/catalog/types.ts` (`TitleQuery.ratingMax`)
- Modify: `apps/api/src/catalog/query.ts` (`buildWhere`)
- Modify: `apps/api/src/routes/v1.ts` (`listQuery`)
- Modify: `apps/desktop/src/main/discover-slice.ts` (`discoverQueryParams`)
- Test: `apps/api/src/catalog/catalog.test.ts`
- Test: `apps/desktop/src/main/discover-slice.test.ts`

**Interfaces:**

- Produces: `TitleQuery.ratingMax?: number`. `discoverQueryParams` sets `ratingMax` only when `filters.ratingMax < 10`.

- [x] **Step 1: Write the failing tests**

Catalogue test: seed ratings 9 and 7, plus one `upsertTitles` row with no rating. `listTitles({ ratingMax: 8, ... })` returns the 7 and the unrated id, not the 9.

Discover test: `discoverQueryParams` with `ratingMax: 8` includes `ratingMax: 8`. The existing default-filter call keeps `"ratingMax" in params` false.

- [x] **Step 2: Run the tests and confirm they fail**

- [x] **Step 3: Implement the ceiling**

Add `ratingMax` beside `ratingMin` on `TitleQuery` and on `listQuery` (`z.coerce.number().min(0).max(10).optional()`). In `buildWhere`, when `ratingMax` is set, add `(t.imdb_rating IS NULL OR t.imdb_rating <= @ratingMax)`. In `discoverQueryParams`, set `ratingMax` only when `filters.ratingMax < 10`.

- [x] **Step 4: Run the tests and confirm they pass**

- [x] **Step 5: Commit** `fix: apply the Discover rating ceiling in the catalogue`

### Task 2: Rebuild windows

**Files:**

- Create: `apps/api/src/build/rebuild-window.ts`
- Create: `apps/api/src/build/rebuild-window.test.ts`
- Modify: `apps/api/src/build/import-basics.ts` (`ingestTitles`)
- Modify: `apps/api/src/build/run-build.ts` (`runBuildCredits`)

**Interfaces:**

- Produces:
  - `withTitleIngest<T>(catalog: CatalogDatabase, work: () => Promise<T>): Promise<T>`
  - `withCreditsWrite(catalog: CatalogDatabase, work: () => Promise<void>): Promise<void>`

- [x] **Step 1: Write the failing credits-window test**

Throwing work leaves `creditsReady()` false. Successful work leaves it true.

- [x] **Step 2: Run the test and confirm it fails**

- [x] **Step 3: Implement the windows and switch the callers**

`ingestTitles` calls `withTitleIngest`. `runBuildCredits` calls `withCreditsWrite` around the scan and insert. Fingerprint, `queueAnalyze`, and the skip-if-unchanged check stay in `runBuildCredits`.

- [x] **Step 4: Run the new test and `title ingest reconciles without wiping survivors`**

- [x] **Step 5: Commit** `fix: close title and credits writes inside one window each`

### Task 3: Drop unread TMDb usability

**Files:**

- Modify: `apps/api/src/services/ensure-catalog.ts` (`isCatalogUsable`)
- Modify: `apps/api/src/services/ensure-catalog.test.ts`
- Modify: `apps/api/src/routes/health.ts`

**Interfaces:**

- Produces: `isCatalogUsable(input: { titlesReady: boolean; creditsReady: boolean; creditsFailed?: boolean }): boolean`

- [x] **Step 1: Update the usability tests to stop passing `tmdbReady`**

- [x] **Step 2: Remove the parameter and the two call sites**

- [x] **Step 3: Run `ensure-catalog.test.ts`**

- [x] **Step 4: Commit** `fix: stop treating TMDb completion as catalogue usability`

### Task 4: Shared poster fill decision

**Files:**

- Modify: `apps/desktop/src/renderer/src/lib/use-visible-media.ts`
- Create: `apps/desktop/src/renderer/src/lib/use-visible-media.test.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**

- Produces:
  - `MEDIA_FILL_LIMIT = 40`
  - `MEDIA_RETRY_MS = 30_000`
  - `mediaIdsToFill({ ids, resolved, retryAt, now, limit }): string[]`
  - `clearPendingRetries(retryAt, completedIds, resolved): void`

- [x] **Step 1: Write the failing fill-decision test**

An id inside the retry window is skipped. A resolved id is skipped. The limit is 40. `clearPendingRetries` removes a completed id that is not resolved.

- [x] **Step 2: Run the test and confirm it fails**

- [x] **Step 3: Use the helpers in `useVisibleMedia` and the open-title effect**

- [x] **Step 4: Run the test**

- [x] **Step 5: Commit** `fix: share poster fill backoff between the list and the open title`

### Task 5: Catalogue ownership decision

**Files:**

- Create: `apps/desktop/src/main/catalog-owner.ts`
- Create: `apps/desktop/src/main/catalog-owner.test.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts`
- Modify: `apps/desktop/src/main/ipc.ts`

**Interfaces:**

- Produces:
  - `catalogOwner(serviceOwns: boolean): "service" | "desktop"`
  - `catalogUnreachableStep(owner: "service" | "desktop"): "refuse" | "spawn"`
  - `catalogUrlChangeAllowed(owner: "service" | "desktop"): boolean`

- [x] **Step 1: Write the failing ownership test**

Service owner refuses and locks the URL. Desktop owner spawns and allows the URL change.

- [x] **Step 2: Run the test and confirm it fails**

- [x] **Step 3: Use the functions in bootstrap, recover, spawn, and settings URL lock**

- [x] **Step 4: Run the test and `npm run typecheck --workspace=rescore`**

- [x] **Step 5: Commit** `fix: decide catalogue spawn and URL lock in one place`
