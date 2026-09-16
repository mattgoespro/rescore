# App Experience Bugs Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the desktop app from blocking on catalogue dump checks, make Discover sort and history match user expectation, fix For You row overflow/spacing, and stop the TMDB poster log from lying.

**Architecture:** Keep last-known-good SQLite ready for UI while dump freshness runs in the background. Align the Discover “IMDb-style rating” sort with the displayed `imdb_rating`. Persist search history through the main-process store. Constrain the For You ranked-row grid. Deduplicate poster enrichment logs.

**Tech Stack:** Express catalog API, better-sqlite3, Electron + React renderer, node:test for API, add desktop unit tests with `tsx --test`.

## Global Constraints

- Do not wipe SQLite or library data on startup checks.
- Do not re-download dumps when local gzip + ETag/size still match.
- First-time empty catalogue may still block on a real build.
- Forced Settings rebuild may still show a blocking loader.
- Existing posters and synopses stay on reconcile.
- Desktop currently has **no** unit tests; add focused `tsx --test` files rather than a new framework.
- Follow TDD: failing test, then minimal implementation, then verify.

---

### Task 1: Keep a usable catalogue ready during dump checks

**Files:**
- Modify: `apps/api/src/services/ensure-catalog.ts`
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/build/download-dumps.ts` (progress copy only if needed)
- Test: `apps/api/src/catalog/catalog.test.ts` or new `apps/api/src/services/ensure-catalog.test.ts`

**Interfaces:**
- Consumes: `catalogIsUsable()`, `buildCatalogTitles()`, `CatalogStatusDto`
- Produces: `phase` stays `"ready"` when SQLite is usable and `force` is false; progress messages still flow; `health.ready === true` whenever `titleCount > 0 && phase !== "error"` unless a **forced** rebuild is in progress

- [ ] **Step 1: Write the failing test**

Add a test that builds a tiny in-memory/temp catalogue, marks it usable, then runs `ensureCatalog` with an `onProgress`-equivalent assertion: while dump checking reports `"Checking …"`, `catalogStatus().phase` remains `"ready"` and `health.ready` would be true.

```ts
test("usable catalog stays ready during dump checks", async () => {
  // seed catalog with titleCount > 0, builtAt set, healthy
  const phases: string[] = [];
  // hook progress by calling ensureCatalog and reading catalogStatus in onProgress
  // assert phases never include "building" when force is false and catalog is usable
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@rescore/api`

Expected: FAIL because `ensure-catalog.ts` sets `phase: "building"` in `onProgress`.

- [ ] **Step 3: Write minimal implementation**

In `runEnsure`, when `usable` is true:

- Do **not** overwrite `phase` to `"building"` in `onProgress`.
- Update `message` (and `download` only if bytes are actually transferring).
- Keep `health.ts` `ready` true when `titleCount > 0 && runtime.phase !== "error"` **or** explicitly: `ready = titlesReady && phase !== "error" && !(forceRebuild && phase === "building")`.

Recommended `health.ready`:

```ts
const forceBlockingBuild = runtime.phase === "building" && !runtime.titlesReady;
const ready = titleCount > 0 && !forceBlockingBuild && runtime.phase !== "error";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=@rescore/api`

Expected: PASS, existing fingerprint/skip tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ensure-catalog.ts apps/api/src/routes/health.ts apps/api/src/**/*.test.ts
git commit -m "$(cat <<'EOF'
Keep a usable catalog ready while dump checks run.

EOF
)"
```

---

### Task 2: Unblock the desktop UI on titlesReady

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/main/catalog-runtime.ts` (`pollUntilSettled`, loader messages)
- Modify: `apps/desktop/src/renderer/src/components/catalog-loader/index.tsx` if copy lives there
- Test: new `apps/desktop/src/renderer/src/lib/catalog-busy.test.ts` extracting the busy predicate

**Interfaces:**
- Consumes: `CatalogStatus.phase`, `titlesReady`, `download`
- Produces: `catalogBusy` true only when there is no usable catalogue (`!titlesReady` and phase is starting/building), not during background refresh

- [ ] **Step 1: Extract and test the gate**

```ts
export function isCatalogUiBlocked(status: {
  phase: string;
  titlesReady?: boolean;
  titleCount: number;
} | null): boolean {
  if (!status) return true;
  if (status.phase === "error") return false;
  if (status.titlesReady || status.titleCount > 0) return false;
  return status.phase === "starting" || status.phase === "building";
}
```

Test: ready+titlesReady → not blocked; building+titleCount 482500 → not blocked; building+titleCount 0 → blocked.

- [ ] **Step 2: Run test to verify it fails**

Desktop has no test runner wired. Add `"test": "tsx --test src/renderer/src/lib/catalog-busy.test.ts"` to `apps/desktop/package.json` (or a small node test glob). Run it; expect FAIL until App uses the helper.

- [ ] **Step 3: Wire App.tsx and loader copy**

Replace `catalogBusy` with `isCatalogUiBlocked(catalogStatus)`.

Loader `detail` must not say “several hundred MB” unless `download?.receivedBytes` is growing:

- Checking / reusing: “Looking for catalogue updates. You can keep using the current titles.”
- Downloading: existing byte progress.
- First build (`!titlesReady`): existing dataset-size copy.

`pollUntilSettled` should return when health is ready **or** `titlesReady && titleCount > 0`, not only `phase === "ready"` if we still emit `building` for forced rebuilds. After Task 1, later launches should already be `ready`.

- [ ] **Step 4: Verify**

Run desktop unit test + `npm run typecheck --workspace=rescore`.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
Open the app when a local catalog is already usable.

EOF
)"
```

---

### Task 3: Background dump refresh without blocking import

**Files:**
- Modify: `apps/api/src/build/run-build.ts`
- Modify: `apps/api/src/services/ensure-catalog.ts`
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `downloadTitleDumps`, `titleDumpFingerprint`, `ingestTitles`
- Produces: startup path with `force !== true` never awaits a full ingest before returning control to a usable catalog; ingest of newer dumps may run after ready

- [ ] **Step 1: Failing test**

When catalogue is usable and dumps are unchanged, `buildCatalogTitles` returns quickly with `unchanged: true` (already true). Add: when dumps **would** change, a new option `deferIfUsable: true` returns the existing meta immediately and continues ingest without flipping UI to blocked.

If deferral is too large for this pass, skip ingest deferral and stop after Tasks 1–2 (HEAD no longer blocks). Document that ETag changes still do a foreground ingest until Task 3 lands.

**Recommended minimum for this task:** if `usable && !force`, run dump check + fingerprint compare; on mismatch, start ingest **without** waiting in `ensureCatalog` (void the promise, keep phase ready, message “Updating catalogue in the background…”). On match, current skip.

- [ ] **Step 2: Implement skip-or-defer in `runBuildTitles`**

Do not delete fingerprint skip. Add the deferral branch only when `catalog.titleCount() > 0`.

- [ ] **Step 3: Verify + commit**

```bash
git commit -m "$(cat <<'EOF'
Refresh IMDb dumps in the background when a catalog already exists.

EOF
)"
```

---

### Task 4: Make IMDb-style rating sort match the stars

**Files:**
- Modify: `apps/api/src/catalog/query.ts` (`orderColumn.rating`)
- Modify: `apps/api/src/catalog/catalog.test.ts` (replace or split the bayesian test)
- Modify: `apps/desktop/src/shared/filters.ts` (label stays “IMDb-style rating” or becomes “IMDb rating”)
- Optional: `docs/cataloguing.md` sort table
- Do **not** delete `bayesian_score`; keep it for a future “Weighted rating” sort if needed

**Interfaces:**
- Consumes: `TitleQuery.sort === "rating"`
- Produces: `ORDER BY t.imdb_rating DESC, t.imdb_votes DESC, t.id ASC`

- [ ] **Step 1: Change the existing test to the product rule**

Replace `rating sort uses persisted bayesian score` with:

```ts
test("rating sort uses displayed IMDb rating then votes", () => {
  seedTitle(catalog, { id: "tt-joker", title: "Joker", rating: 8.3, votes: 1_700_000 });
  seedTitle(catalog, { id: "tt-kashmir", title: "The Kashmir Files", rating: 8.5, votes: 580_000 });
  const page = catalog.listTitles({ page: 1, pageSize: 10, sort: "rating", order: "desc" });
  assert.equal(page.data[0]?.id, "tt-kashmir");
  assert.equal(page.data[1]?.id, "tt-joker");
});
```

Keep a separate test that `bayesianScore(9, 500_000) > bayesianScore(10, 12)` still holds for the helper, if the helper remains.

- [ ] **Step 2: Run test — expect FAIL**

Because `orderColumn.rating` is `t.bayesian_score`.

- [ ] **Step 3: Implementation**

```ts
const orderColumn = {
  title: "t.title COLLATE NOCASE",
  year: "t.year",
  rating: "t.imdb_rating",
  votes: "t.imdb_votes",
  updatedAt: "t.updated_at",
} as const;
```

And change ORDER BY for rating to:

```sql
ORDER BY t.imdb_rating DESC, t.imdb_votes DESC, t.id ASC
```

(when `query.sort === "rating"`; other sorts keep `, t.id ASC` only.)

- [ ] **Step 4: Pass tests, update cataloguing.md sort row**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
Sort IMDb-style rating by displayed rating, not bayesian score.

EOF
)"
```

---

### Task 5: Persist search history on successful search

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/Discover.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/search-history-store.ts`
- Modify: `apps/desktop/src/main/store.ts` and `ipc.ts` (move persistence to userData)
- Test: `apps/desktop/src/shared/search-history.test.ts` plus a store test

**Interfaces:**
- Consumes: `snapshotSearchHistory`, `isDefaultSearchHistory`
- Produces: history written when page-1 discover succeeds for a non-default snapshot; durable across launches via `userData`

- [ ] **Step 1: Unit tests for save policy**

```ts
test("non-default filters are recordable immediately", () => {
  const snapshot = snapshotSearchHistory(
    { ...defaultFilters(), sortBy: "vote_average.desc", genres: [18] },
    [{ id: 18, name: "Drama" }],
  );
  assert.equal(isDefaultSearchHistory(snapshot), false);
});
```

Add `shouldRecordSearchHistory({ saved, snapshot })` that returns true when not saved and not default — no scroll/open gate.

- [ ] **Step 2: Call record from `load()` after a successful replace**

Remove the requirement to hit `HISTORY_SCROLL_PX` / `HISTORY_OPEN_COUNT` for saving (keep them only if product still wants “engaged” semantics; this plan **drops the gate** because users experience it as data loss).

- [ ] **Step 3: Persist via main process**

Add `searchHistory: SearchHistoryEntry[]` to `AppStore` (same `rescore.json`). IPC `search-history:list` / `save` / `remove`. Renderer store becomes a thin IPC wrapper. This survives dev vs `file://` origin splits.

- [ ] **Step 4: Verify + commit**

```bash
git commit -m "$(cat <<'EOF'
Save search history when a search succeeds, in userData.

EOF
)"
```

---

### Task 6: Stop For You rows overflowing the match score

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/ForYou.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/ui.ts` (`rankedRow`)
- Test: none of CSS; verify with typecheck + manual For You + inspector open

**Interfaces:**
- Consumes: `rankedRow()`, reason chips, match column
- Produces: content column `min-w-0 overflow-hidden`; match column `shrink-0`; chips wrap inside the 1fr track

- [ ] **Step 1: Content column**

```tsx
<div className="min-w-0 overflow-hidden">
```

- [ ] **Step 2: Match column**

```tsx
<div className="shrink-0 tabular text-[28px] leading-none font-bold tracking-[-0.06em] text-accent">
```

- [ ] **Step 3: Chip wrap safety**

```tsx
<span className="max-w-full break-words rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Keep For You match scores inside the row.

EOF
)"
```

---

### Task 7: Loosen For You chip and rank spacing

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/ForYou.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/ui.ts`

- [ ] **Step 1: `rankedRow` uses `items-start` instead of `items-center`** so rank and match align with the title, not the chip block.

- [ ] **Step 2: Chip row `gap-2`; chips use `px-2.5 py-1` to match `chipClass()`.**

- [ ] **Step 3: Rank/match columns get a little top padding (`pt-0.5`) if `items-start` makes them sit too high.**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Give For You ranked rows room to breathe.

EOF
)"
```

---

### Task 8: Honest, once-per-process TMDB log

**Files:**
- Modify: `apps/api/src/services/tmdb-posters.ts`
- Test: `apps/api/src/services/tmdb-posters.test.ts` (mock catalog + missing key; spy `console.log`)

- [ ] **Step 1: Failing test**

Call `startPosterEnrichment` twice with no key. Assert the empty-poster sentence is emitted **once**, and the message does not say posters stay empty.

- [ ] **Step 2: Implementation**

```ts
let loggedMissingKey = false;

if (!apiKey) {
  if (!loggedMissingKey) {
    loggedMissingKey = true;
    log("No TMDB API key; skipping new poster lookups. Existing poster URLs are unchanged.");
  }
  return Promise.resolve(null);
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
Log a missing TMDB key once and keep existing posters.

EOF
)"
```

---

### Task 9: Regression harness

**Files:**
- Modify: `apps/api/package.json` / `apps/desktop/package.json` test scripts
- Modify: `docs/cataloguing.md` (startup phase, sort, history, posters)

Cover:

1. Usable catalog does not enter blocking `building` on dump HEAD.
2. `sort=rating` orders by `imdb_rating` then `imdb_votes`.
3. Search history records non-default filters without scroll/open gates.
4. Poster missing-key log is single-shot and accurate.

Run: `npm test` (api) and desktop `tsx --test`.

```bash
git commit -m "$(cat <<'EOF'
Document catalog ready-path and add regression coverage.

EOF
)"
```

---

## Self-review

- Spec coverage: bugs 1–7 each have a task (1–2 and 3 for catalog; 4 sort; 5 history; 6–7 layout; 8 posters; 9 harness).
- Placeholder scan: no TBD.
- Type consistency: `titlesReady`, `CatalogStatusDto.phase`, `orderColumn.rating` used as named above.
