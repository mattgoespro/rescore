# Catalogue leftovers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen six catalogue leftovers so status, taste, Library writes, title reads, Discover pages, and list visibility each keep their decision in one place.

**Architecture:** Each phase adds or narrows one module and tests it at that seam. Status changes merge onto the last snapshot. Taste readiness is one rule, and every Library write drops the cache. Library writes return the rows they changed. A title read does not admit poster hydration. An unknown Discover total is null. List kinds share one exclusion rule.

**Tech Stack:** TypeScript, Node `node:test` via `tsx`, better-sqlite3, Prettier. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-04-catalogue-leftovers.md`

## Global Constraints

- `creditsReady` is only the meta flag. Title ingest and credits writing stay separate. `withTitleIngest` / `withCreditsWrite` exist. Fingerprints and `queueAnalyze` stay outside the credits window.
- `TMDB_HYDRATION_PENDING_SQL` includes `languages_checked`. Do not split the TMDb scheduler, key pool, or coordinator. Do not restore a language-only hydration branch.
- `movieFromTitle` maps a catalogue title to one `MovieSummary`.
- `discoverQueryParams` and `loadDiscoverSlice` own the Discover query and the next page (cursor, page size 40, match re-rank, `canLoadMore`). `ratingMax` is a catalogue filter; null imdb ratings stay in range. `ratingMax` of 10 is not sent.
- Phase `building` still blocks the shell via `isCatalogUiBlocked`. Do not unblock a rebuild. The inline rebuild strip stays deleted.
- `settleHealthMiss` uses the probed port. Do not delete `shouldTerminateCatalogApi`.
- `isCatalogUsable` does not take `tmdbReady`. Do not fold catalogue phase into SQLite. Private `catalogIsUsable` in `ensure-catalog.ts` stays titles + `builtAt` + healthy and does not require credits.
- `mediaIdsToFill` / `clearPendingRetries` / `mediaFillSettled` stay shared. The IntersectionObserver stays in `useVisibleMedia`.
- `catalogOwner` / `catalogUnreachableStep` / `catalogUrlChangeAllowed` stay. Health identity checks in `canReach`/`readHealth` stay. Do not rewrite PowerShell or WinSW.
- `serviceMaintenanceAction` and `elevationCommand` stay. Launch skips maintenance when the catalogue process state is running.
- Tests: `node --import tsx --test --test-name-pattern "..." <files>` from the workspace. `npm test -- --test-name-pattern` does not filter reliably.
- Vocabulary in this plan: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

## Review Focus

- A restart change keeps poster hydration, title counts, and the credits flag. Pinned in Task 1.
- A ratings import drops cached taste, and For You does not personal-rank below three ratings. Pinned in Task 2.
- Saving one Library row does not require the other rows, and clear removes every row in one write. Pinned in Task 3.
- A title read with a TMDb key does not fetch posters. Pinned in Task 4.
- A full Discover page with no counted total is not printed as the catalogue size. Pinned in Task 5.
- For You still includes a watchlist title and still uses the 5000 vote floor. Pinned in Task 6.

## Rulings

- The catalogue clear returns the removed rows. The desktop clear handler returns an empty Library to the view, because the view replaces its list with that result. A clear leaves none.
- An unknown Discover total is `null`. The count label is empty. It is not the loaded page length.
- Taste is ready at three rated titles. Below that, For You keeps catalogue order.
- Poster admission is `admitTitleHydration` in the existing poster module. It is the only caller of `coordinator.hydrate` outside the coordinator. A title read does not call it.

---

### Task 1: Status snapshots

**Files:**

- Create: `apps/desktop/src/main/catalog-status-snapshot.ts`
- Create: `apps/desktop/src/main/catalog-status-snapshot.test.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts` (`publish` and every caller)

**Interfaces:**

- Produces: `catalogStatusSnapshot(current: CatalogStatus, change: { phase: CatalogPhase; message: string } & Partial<Omit<CatalogStatus, "phase" | "message">>): CatalogStatus`
- Omitted fields stay. `null` on `error`, `download`, or `builtAt` replaces the previous value. `0` replaces `titleCount`.

- [x] **Step 1: Write the failing test**

`catalog-status-snapshot.test.ts`: a ready status with `titleCount` 482500, `titlesReady`, `creditsReady`, and `tmdbHydration` keeps those fields when the change is only `{ phase: "starting", message: "Catalog API stopped; restarting…", error: null }`. A `{ phase: "building", message: "Rebuilding catalog from IMDb datasets…", error: null, download: null }` stays `building`, and `isCatalogUiBlocked` of that result is true. An explicit `titleCount: 12` replaces the count.

- [x] **Step 2: Run the test and confirm it fails**

Run: `node --import tsx --test --test-name-pattern "status snapshot" apps/desktop/src/main/catalog-status-snapshot.test.ts`

Expected: FAIL, module missing.

- [x] **Step 3: Implement the snapshot and point `publish` at it**

`publish` sends the merged status. Callers pass phase, message, and only fields that change. `statusFromHealth` is still published whole. Hydration events pass the current phase and message plus `tmdbHydration`.

- [x] **Step 4: Run the test and confirm it passes**

- [x] **Step 5: Commit** `fix: keep catalogue status fields across restarts`

### Task 2: Taste

**Files:**

- Create: `apps/desktop/src/main/taste-cache.ts`
- Create: `apps/desktop/src/main/taste-cache.test.ts`
- Modify: `apps/desktop/src/main/ranking.ts` (`tasteReady`, `tasteRanked`, `publicProfile`)
- Modify: `apps/desktop/src/main/discover-slice.ts` (`loadDiscoverSlice`)
- Modify: `apps/desktop/src/main/ipc.ts` (Library writes and `forYou`)
- Test: `apps/desktop/src/main/discover-slice.test.ts` (existing match tests stay)

**Interfaces:**

- Consumes: `loadDiscoverSlice` still takes `ratedCount` and `rankPage`.
- Produces:
  - `tasteReady(ratedCount: number): boolean` — true at 3 or more
  - `tasteRanked<T>(ratedCount: number, movies: T[], rank: (movies: T[]) => T[]): T[]`
  - `createTasteCache<T>()` with `read` and `drop`
  - `withLibraryWrite<T>(cache: { drop(): void }, write: () => Promise<T>): Promise<T>` drops the cache after the write, including when the write throws

- [x] **Step 1: Write the failing tests**

`taste-cache.test.ts`: two reads load once; `drop` makes the next read load again; `withLibraryWrite` drops even when the write throws.

A ranking test in the same file, or `ranking` covered from `taste-cache.test.ts`: `tasteReady(2)` is false, `tasteReady(3)` is true, and `tasteRanked` does not call `rank` at 2. `publicProfile` of two rated Library rows has `ready: false`; three has `ready: true`.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test --test-name-pattern "taste" apps/desktop/src/main/taste-cache.test.ts`

- [x] **Step 3: Implement**

`publicProfile.ready` uses `tasteReady`. `loadDiscoverSlice` uses `tasteRanked` when `sortBy === "match"`. `forYou` uses `tasteRanked` and otherwise keeps catalogue order with `match: 0`. Upsert, remove, clear, and each CSV save go through `withLibraryWrite`.

- [x] **Step 4: Run taste tests and the existing discover-slice tests**

- [x] **Step 5: Commit** `fix: drop cached taste on every Library write`

### Task 3: Library write

**Files:**

- Modify: `apps/api/src/catalog/query.ts` (`libraryEntriesFromWrites`)
- Modify: `apps/api/src/catalog/database.ts` (`saveLibrary`, `deleteLibrary`, `clearLibrary`)
- Modify: `apps/api/src/routes/v1.ts` (`DELETE /library`)
- Modify: `apps/desktop/src/main/catalog-client.ts` (`clearLibrary`)
- Modify: `apps/desktop/src/main/ipc.ts` (`library:clear`)
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**

- Produces:
  - `libraryEntriesFromWrites(db, rows): LibraryEntryDto[]` hydrates only the written title ids
  - `saveLibrary(...): LibraryEntryDto | null`
  - `deleteLibrary(id): LibraryEntryDto | null`
  - `clearLibrary(): LibraryEntryDto[]`
- Desktop `library:clear` calls `clearLibrary` once and returns `[]` to the view.

- [x] **Step 1: Write the failing tests**

In `catalog.test.ts`: save of one title among three returns that title's rating and note, and `listLibrary` still has three. `deleteLibrary` returns the removed row, and a second delete returns null. `clearLibrary` returns both removed ids and leaves the Library empty. These fail because delete returns a boolean and `clearLibrary` is missing.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `node --import tsx --test --test-name-pattern "library write" apps/api/src/catalog/catalog.test.ts`

- [x] **Step 3: Implement the writes and the clear route**

`DELETE /v1/library` returns `{ data: affected }`. The desktop client calls it. `library:clear` no longer lists and deletes one by one.

- [x] **Step 4: Run the library write tests and the existing catalogue tests that save Library rows**

- [x] **Step 5: Commit** `fix: return Library rows from the write`

### Task 4: Title read

**Files:**

- Modify: `apps/api/src/services/tmdb-posters.ts` (`admitTitleHydration`, `fillTitles`, `enrichPosters`, `enrichOneTitle`)
- Modify: `apps/api/src/routes/v1.ts` (`GET /titles/:id`)
- Test: `apps/api/src/catalog/catalog.test.ts`
- Test: `apps/api/src/services/tmdb-posters.test.ts`

**Interfaces:**

- Produces: `admitTitleHydration(catalog, id, kind, interactive): Promise<boolean>`
- `coordinator.hydrate` is called from that function only, outside the coordinator class.
- `GET /titles/:id` returns `{ data: title }` and does not call it.

- [ ] **Step 1: Write the failing tests**

Catalogue test: with `TMDB_API_KEYS` set and `fetch` counting calls, `GET /v1/titles/:id` returns the title and the fetch count stays 0.

Poster test: two `admitTitleHydration` calls for one in-flight title return the same promise, and `fillTitles` during an in-flight background pass does not add a second fetch.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

Remove the title-route admission. `fillTitles`, `enrichPosters`, and `enrichOneTitle` call `admitTitleHydration`.

- [ ] **Step 4: Run the new tests and the existing poster tests**

- [ ] **Step 5: Commit** `fix: keep title reads from enqueueing poster hydration`

### Task 5: Discover total

**Files:**

- Modify: `apps/api/src/catalog/query.ts` (`listTitles` total)
- Modify: `apps/api/src/catalog-types.ts` (`pagination.total`, `pagination.totalPages`)
- Modify: `apps/desktop/src/shared/ranking-types.ts` (`PagedMovies`)
- Modify: `apps/desktop/src/main/discover-slice.ts` (`discoverHasAnotherPage`)
- Modify: `apps/desktop/src/main/catalog-client.ts` (`discover`)
- Create: `apps/desktop/src/renderer/src/lib/discover-count.ts`
- Create: `apps/desktop/src/renderer/src/lib/discover-count.test.ts`
- Modify: `apps/desktop/src/renderer/src/views/Discover.tsx`
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**

- Produces:
  - `pagination.total: number | null` and `pagination.totalPages: number | null`
  - `discoverHasAnotherPage(count: number, nextCursor: string | null): boolean`
  - `discoverCountLabel(total: number | null, searching: boolean): string`
- A full uncounted page has `total: null`. A short page has `total === offset + rows.length`. Label is `""` when `total` is null and the view is not searching, `"Searching…"` while searching with no known total, `"No titles"` at 0, and `"N titles"` for a known positive total.

- [ ] **Step 1: Write the failing tests**

Replace the full-page `includeTotal: false` assertion (`total === 3`) with `total === null` and a string `nextCursor`. Add a short page whose total is the row count. `discoverCountLabel(null, false)` is `""`. `discoverCountLabel(41, false)` is not used as a stand-in; `discoverCountLabel(12, false)` is `"12 titles"`.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

Stop the `offset + rows.length + 1` sentinel. Client and `loadDiscoverSlice` both call `discoverHasAnotherPage`. The view stores `number | null` and prints `discoverCountLabel`. Do not invent a page count from a missing total.

- [ ] **Step 4: Run the catalogue page tests, discover-slice tests, and discover-count tests**

- [ ] **Step 5: Commit** `fix: stop treating an unknown Discover total as the catalogue size`

### Task 6: Library visibility

**Files:**

- Create: `apps/api/src/catalog/library-visibility.ts`
- Create: `apps/api/src/catalog/library-visibility.test.ts`
- Modify: `apps/api/src/catalog/query.ts` (`buildWhere`, `listForYouCandidates`)
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**

- Produces: `excludedLibraryStatuses({ kind: "discover" | "forYou"; hideWatched?: boolean; hideWatchlist?: boolean }): LibraryStatus[]`
- Discover: `skipped`, plus `watched` and `watchlist` when those flags are set.
- For You: `watched` and `skipped`, ignoring hide flags.
- The vote floor in `listForYouCandidates` stays `t.imdb_votes >= 5000`.

- [ ] **Step 1: Write the failing tests**

`library-visibility.test.ts` asserts the three status lists above. Catalogue test: a watchlist title with 9000 votes is a For You candidate; a title with 4999 votes is not; Discover with `hideWatched` omits a watched title and still omits a skipped title.

- [ ] **Step 2: Run the tests and confirm the new module test fails**

- [ ] **Step 3: Implement**

`buildWhere` and `listForYouCandidates` ask `excludedLibraryStatuses` and emit one `NOT EXISTS` for those statuses. Keep the existing skip when no skipped row exists and skipped is the only extra predicate that would have been omitted.

- [ ] **Step 4: Run the visibility tests and the existing skipped / for-you catalogue tests**

- [ ] **Step 5: Commit** `fix: share Library status exclusion across Discover and For You`

### Task 7: Follow-up review

- [ ] **Step 1: Re-read the modules this plan touched**

`catalog-runtime`, `catalog-status-snapshot`, `ipc`, `taste-cache`, `ranking`, `discover-slice`, `query`, `database`, `tmdb-posters`, `v1`, `Discover.tsx`.

- [ ] **Step 2: Apply the deletion test**

Implement another candidate only when deleting it would scatter real complexity, the interface is nearly as large as the implementation, or a pure helper's callers still hide the bug. Skip speculative cleanups and anything in Global Constraints.

- [ ] **Step 3: Record the stopping review in this file**

What was looked at, and why nothing further shipped.

- [ ] **Step 4: Commit the review note if it is not already in the last code commit** `docs: record the catalogue leftover stopping review`
