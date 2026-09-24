# Catalog Concern Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop surprise full-catalogue rebuilds, keep rebuild and credits state visible, restart a hung local API, and make Discover, posters, and filters cheaper and honest.

**Architecture:** A usable SQLite catalogue stays the search source. A changed IMDb dump is recorded and left unparsed until Settings rebuild (`force: true`). Discover stops asking for `COUNT(*)` and pages with a sort-key cursor instead of `OFFSET`. Poster lookups run only for titles on screen, paced under TMDb’s quota. Filters the dumps cannot answer are removed; excluded genres and people filters are applied in SQL.

**Tech Stack:** Express catalog API, better-sqlite3, Electron main process, React renderer, `node:test` via `tsx`.

## Global Constraints

- Do not wipe SQLite or library rows on a dump check.
- Do not re-download a gzip when local magic, size, and ETag or Last-Modified still match.
- An empty catalogue (`titleCount === 0`) may still block the UI and run a full title ingest.
- Settings **Rebuild catalog** (`POST /v1/catalog/rebuild` with `force: true`) still downloads and reconciles.
- TMDb stays the poster and synopsis overlay. Do not move Discover onto TMDb.
- IMDb rating and vote count remain the sort and filter columns.
- Desktop tests: `npm test --workspace=rescore`. API tests: `npm test --workspace=@rescore/api`.
- Follow TDD: failing test, then the minimum implementation, then a passing run, then a commit.

---

## File structure

- `apps/api/src/build/defer-ingest.ts` — pure “should we parse?” decision. Created in Task 1.
- `apps/api/src/build/run-build.ts` — call that decision before `parseRatingsTsv`.
- `apps/api/src/catalog/database.ts` — `titlesUpdateAvailable` flag, people search, poster list limited to requested ids, `busy_timeout`.
- `apps/api/src/catalog/query.ts` — keyset `WHERE`, excluded genres, person filters, optional total.
- `apps/api/src/routes/v1.ts` and `apps/api/src/routes/health.ts` — new query params and health fields.
- `apps/api/src/services/tmdb-posters.ts` and `apps/api/src/index.ts` — on-demand, paced poster lookups.
- `apps/api/src/catalog/work-queue.ts` and `apps/api/src/build/types.ts` — shorter write batches, later `ANALYZE`.
- `apps/desktop/src/main/api-watch.ts` — pure hung-child rule. Created in Task 3.
- `apps/desktop/src/main/catalog-runtime.ts` — use that rule inside `watchApi`.
- `apps/desktop/src/main/catalog-client.ts` — no total on Discover, send cursor and real filters.
- `apps/desktop/src/renderer/src/App.tsx` and `views/Discover.tsx` — visible rebuild status, cursor paging.
- `apps/desktop/src/shared/filters.ts` — drop keyword, provider, and language fields.

---

### Task 1: Do not parse a changed dump while the catalogue is usable

**Files:**
- Create: `apps/api/src/build/defer-ingest.ts`
- Create: `apps/api/src/build/defer-ingest.test.ts`
- Modify: `apps/api/src/build/run-build.ts`
- Modify: `apps/api/src/catalog/database.ts`
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/desktop/src/shared/catalog-status.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts` (`statusFromHealth`)
- Modify: `apps/desktop/src/renderer/src/views/Settings.tsx` (`catalogSummary`)

**Interfaces:**
- Consumes: `dumpFingerprint` (`etag ?? lastModified ?? size`) and `catalog.titleDumpFingerprint()`
- Produces: `shouldDeferTitleIngest(input: { force: boolean; titleCount: number; builtAt: string | null; storedFingerprint: string | null; remoteFingerprint: string | null }): boolean`
- Produces: `CatalogDatabase.setTitlesUpdateAvailable(ready: boolean): void` and `titlesUpdateAvailable(): boolean`
- Produces: health and `CatalogStatus.titlesUpdateAvailable: boolean`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldDeferTitleIngest } from "./defer-ingest.js";

test("a usable catalogue with a new remote fingerprint is not parsed", () => {
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 482_500,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "old-etag\nold-basics",
      remoteFingerprint: "new-etag\nold-basics",
    }),
    true,
  );
});

test("force, an empty catalogue, and a matching fingerprint still ingest or skip as before", () => {
  assert.equal(
    shouldDeferTitleIngest({
      force: true,
      titleCount: 482_500,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "old",
      remoteFingerprint: "new",
    }),
    false,
  );
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 0,
      builtAt: null,
      storedFingerprint: null,
      remoteFingerprint: "new",
    }),
    false,
  );
  assert.equal(
    shouldDeferTitleIngest({
      force: false,
      titleCount: 10,
      builtAt: "2026-09-01T00:00:00.000Z",
      storedFingerprint: "same",
      remoteFingerprint: "same",
    }),
    false,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/build/defer-ingest.test.ts`

Expected: FAIL with `shouldDeferTitleIngest` is not exported.

- [ ] **Step 3: Implement the deferral**

`apps/api/src/build/defer-ingest.ts`:

```ts
export function shouldDeferTitleIngest(input: {
  force: boolean;
  titleCount: number;
  builtAt: string | null;
  storedFingerprint: string | null;
  remoteFingerprint: string | null;
}): boolean {
  return (
    !input.force &&
    input.titleCount > 0 &&
    Boolean(input.builtAt) &&
    input.storedFingerprint != null &&
    input.remoteFingerprint != null &&
    input.storedFingerprint !== input.remoteFingerprint
  );
}
```

In `runBuildTitles`, after the remote HEAD probes for ratings and basics and before `downloadTitleDumps` would fetch a changed body, build `remoteFingerprint` the same way as `titleDumpKey` (`etag ?? lastModified ?? contentLength`). `probeRemote` in `apps/api/src/services/gzip-tsv.ts` already returns those fields; export it if it is not exported. When `shouldDeferTitleIngest` is true:

- do not call `parseRatingsTsv` or `ingestTitles`
- `catalog.setTitlesUpdateAvailable(true)`
- return the existing `{ titleCount, builtAt, revision, unchanged: true }`

When fingerprints match, keep today’s early return and call `catalog.setTitlesUpdateAvailable(false)`. When `force` is true, download and reconcile as today, then `catalog.setTitlesUpdateAvailable(false)`.

Add the flag with the existing `setFlag` / `flagIsSet` helpers:

```ts
setTitlesUpdateAvailable(ready: boolean): void {
  setFlag(this.db, "titlesUpdateAvailable", ready);
}
titlesUpdateAvailable(): boolean {
  return flagIsSet(this.db, "titlesUpdateAvailable");
}
```

Add `titlesUpdateAvailable: boolean` to the API `HealthResponse` and to desktop `CatalogStatus`. `health.ts` sets it from `catalog.titlesUpdateAvailable()`. `statusFromHealth` copies `health.titlesUpdateAvailable === true`.

In `catalogSummary`, when the flag is set, append: `A newer IMDb dump is available. Rebuild when you want it.`

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=@rescore/api -- src/build/defer-ingest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/build/defer-ingest.ts apps/api/src/build/defer-ingest.test.ts apps/api/src/build/run-build.ts apps/api/src/catalog/database.ts apps/api/src/routes/health.ts apps/api/src/types.ts apps/desktop/src/shared/catalog-status.ts apps/desktop/src/main/catalog-runtime.ts apps/desktop/src/renderer/src/views/Settings.tsx
git commit -m "$(cat <<'EOF'
Leave a usable catalogue in place when IMDb dumps change.

EOF
)"
```

---

### Task 2: Keep rebuild progress visible after leaving Settings

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Test: `apps/desktop/src/renderer/src/lib/catalog-busy.test.ts`

**Interfaces:**
- Consumes: `catalogRebuildFeedback` from `apps/desktop/src/renderer/src/lib/catalog-busy.ts` (`{ label: string; button: string } | null`)
- Consumes: `CatalogLoader` `layout="inline"`
- Produces: a `role="status"` strip above the current view whenever `catalogRebuildFeedback(catalogStatus)` is non-null and `isCatalogUiBlocked(catalogStatus)` is false

Settings already swaps the rebuild button to “Rebuilding…” and renders an inline loader. This task covers the other views.

- [ ] **Step 1: Write the failing test**

Add to `catalog-busy.test.ts`:

```ts
test("rebuild feedback stays available when existing titles keep the app unlocked", () => {
  const status = {
    phase: "building",
    message: "Rebuilding catalog from IMDb datasets…",
    titlesReady: true,
    titleCount: 482_500,
  };
  assert.equal(isCatalogUiBlocked(status), false);
  assert.equal(
    catalogRebuildFeedback(status)?.label,
    "Rebuilding catalog from IMDb datasets…",
  );
});
```

- [ ] **Step 2: Run the test**

Run: `npm test --workspace=rescore -- src/renderer/src/lib/catalog-busy.test.ts`

Expected: PASS. `catalogRebuildFeedback` is already exported. This test locks the rule the strip depends on: a building catalogue that already has titles is not full-page blocked, and it still has a label.

- [ ] **Step 3: Render the strip in App**

Inside `<main>`, above the view switch, when `!catalogBusy`:

```tsx
{!catalogBusy && rebuildFeedback ? (
  <div
    className={cn(
      "mb-3",
      (discoverLayout || forYouLayout) && "shrink-0",
      discoverLayout && "mx-4 mt-3 mb-0",
    )}
    role="status"
    aria-live="polite"
  >
    <CatalogLoader
      layout="inline"
      label={rebuildFeedback.label}
      download={catalogStatus?.download}
    />
  </div>
) : null}
```

`const rebuildFeedback = catalogRebuildFeedback(catalogStatus);`

Do not show this strip when `catalogBusy` is true; the full-page `CatalogLoader` already covers an empty catalogue.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:web --workspace=rescore`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/lib/catalog-busy.test.ts
git commit -m "$(cat <<'EOF'
Show catalog rebuild progress on every view.

EOF
)"
```

---

### Task 3: Restart a local API child that is alive but not answering

**Files:**
- Create: `apps/desktop/src/main/api-watch.ts`
- Create: `apps/desktop/src/main/api-watch.test.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts` (`watchApi`)

**Interfaces:**
- Produces: `shouldRestartHungChild(consecutiveUnreachable: number): boolean` — true at 3
- `watchApi` increments a counter when `canReach` is false. A live child (`exitCode == null`) no longer skips recovery. At 3 misses (~9s at the existing 3s poll) call the existing `recoverApi`. A reachable poll sets the counter to 0.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRestartHungChild } from "./api-watch.js";

test("three missed health checks restart a child that has not exited", () => {
  assert.equal(shouldRestartHungChild(2), false);
  assert.equal(shouldRestartHungChild(3), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=rescore -- src/main/api-watch.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

```ts
export function shouldRestartHungChild(consecutiveUnreachable: number): boolean {
  return consecutiveUnreachable >= 3;
}
```

In `watchApi`, replace the branch that `continue`s while `spawned.exitCode == null`:

```ts
let misses = 0;
while (generation === gen && !quitting) {
  await sleep(3000);
  if (generation !== gen || quitting) return;
  if (await canReach(baseUrl)) {
    misses = 0;
    restartAttempts = 0;
    continue;
  }
  misses += 1;
  const childAlive = spawned != null && spawned.exitCode == null;
  if (childAlive && !shouldRestartHungChild(misses)) continue;
  if (childAlive) {
    await killProcessTree(spawned);
    spawned = null;
    misses = 0;
  }
  await recoverApi(baseUrl, gen);
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=rescore -- src/main/api-watch.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/api-watch.ts apps/desktop/src/main/api-watch.test.ts apps/desktop/src/main/catalog-runtime.ts
git commit -m "$(cat <<'EOF'
Restart the catalog API when health checks stop answering.

EOF
)"
```

---

### Task 4: Stop Discover from waiting on COUNT(*)

**Files:**
- Modify: `apps/desktop/src/main/catalog-client.ts` (`discover` and `discoverQuery`)
- Modify: `apps/desktop/src/renderer/src/views/Discover.tsx` (`canLoadMore`)
- Test: `apps/api/src/catalog/catalog.test.ts` (existing `includeTotal false` test must still pass)

**Interfaces:**
- Consumes: `includeTotal=false` already implemented in `listTitles`
- Produces: Discover always sends `includeTotal: "false"`
- Produces: `canLoadMore` is true when the last page returned `pageSize` rows (`40`), false when it returned fewer

- [ ] **Step 1: Write the failing desktop test**

Create `apps/desktop/src/main/discover-paging.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { canLoadMoreFromPage } from "./discover-paging.js";

test("a full page can load another and a short page is the end", () => {
  assert.equal(canLoadMoreFromPage(40, 40), true);
  assert.equal(canLoadMoreFromPage(12, 40), false);
  assert.equal(canLoadMoreFromPage(0, 40), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=rescore -- src/main/discover-paging.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

```ts
export function canLoadMoreFromPage(resultCount: number, pageSize: number): boolean {
  return resultCount >= pageSize;
}
```

In `discoverQuery`, set `includeTotal: "false"` for every page. Remove the `filters.page > 1` branch.

In `Discover.tsx`, store `lastPageFull` from `canLoadMoreFromPage(data.results.length, 40)` and use that in `canLoadMore` instead of `pageRef.current < totalPagesRef.current`. Keep showing `totalResults` only when `data.totalResults > 0`. When the total was not requested, `titleCount` should show the number of loaded rows (`items.length`) rather than `0`.

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=rescore -- src/main/discover-paging.test.ts`

Expected: PASS.

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts`

Expected: PASS, including `includeTotal false still pages when the page is full`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/discover-paging.ts apps/desktop/src/main/discover-paging.test.ts apps/desktop/src/main/catalog-client.ts apps/desktop/src/renderer/src/views/Discover.tsx
git commit -m "$(cat <<'EOF'
Let Discover render a page without counting the whole catalogue.

EOF
)"
```

---

### Task 5: Page Discover with a sort cursor instead of OFFSET

**Files:**
- Modify: `apps/api/src/catalog/query.ts`
- Modify: `apps/api/src/catalog/types.ts`
- Modify: `apps/api/src/catalog-types.ts`
- Modify: `apps/api/src/routes/v1.ts`
- Modify: `apps/desktop/src/shared/catalog-dto.ts`
- Modify: `apps/desktop/src/shared/ranking-types.ts`
- Modify: `apps/desktop/src/main/catalog-client.ts`
- Modify: `apps/desktop/src/renderer/src/views/Discover.tsx`
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**
- Produces: `encodeTitleCursor(row: { id: string; imdb_votes: number | null; imdb_rating: number | null; year: number | null; title: string; updated_at?: string }): string` — base64url JSON
- Produces: `decodeTitleCursor(value: string): { id: string; votes: number | null; rating: number | null; year: number | null; title: string; updatedAt: string | null } | null`
- Produces: `TitleListResponse.pagination.nextCursor: string | null`
- Produces: `TitleQuery.cursor?: string`. When `cursor` is set, `listTitles` ignores `page` for the offset and applies the keyset predicate. `page` in the response stays `1`.
- Desktop `PagedMovies.nextCursor: string | null`. Discover stores it and sends it as `cursor` on the next request. A filter change clears it.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/catalog/catalog.test.ts`:

```ts
test("votes sort pages with a cursor instead of offset", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "Low", rating: 7, votes: 10 });
  seedTitle(catalog, { id: "tt0000002", title: "Mid", rating: 7, votes: 20 });
  seedTitle(catalog, { id: "tt0000003", title: "High", rating: 7, votes: 30 });
  const first = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
  });
  assert.equal(first.data[0]?.id, "tt0000003");
  assert.equal(typeof first.pagination.nextCursor, "string");
  const second = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
    cursor: first.pagination.nextCursor ?? undefined,
  });
  assert.equal(second.data[0]?.id, "tt0000002");
  const third = catalog.listTitles({
    page: 1,
    pageSize: 1,
    sort: "votes",
    order: "desc",
    includeTotal: false,
    cursor: second.pagination.nextCursor ?? undefined,
  });
  assert.equal(third.data[0]?.id, "tt0000001");
  assert.equal(third.pagination.nextCursor, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts`

Expected: FAIL because `nextCursor` is undefined.

- [ ] **Step 3: Implement the cursor**

Add `cursor` to `listQuery` as `z.string().trim().min(1).max(500).optional()`.

For `sort: "votes"` and `order: "desc"` the predicate is:

```sql
(t.imdb_votes < @cursorVotes OR (t.imdb_votes = @cursorVotes AND t.id > @cursorId))
```

For `order: "asc"`, flip `<` to `>`. Use the same shape for `rating` (`imdb_rating`), `year`, and `title` (`title COLLATE NOCASE`), always breaking ties with `t.id`. Treat a null sort value as a seek only on `t.id` when the cursor’s sort field is null. Invalid JSON returns null from `decodeTitleCursor` and the query then starts at the first row.

`nextCursor` is the encoding of the last row when `rows.length === pageSize`, otherwise `null`.

Do not use `OFFSET` when `cursor` is present. Leave `OFFSET` in place only when `cursor` is absent, so existing page tests keep working.

Desktop `discover()` puts `response.pagination.nextCursor` on `PagedMovies`. `Discover.tsx` keeps `cursorRef`. `loadMore` calls discover with `{ ...filters, cursor: cursorRef.current, page: 1 }`. A new filter key sets `cursorRef.current = null`.

- [ ] **Step 4: Run the catalog tests**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/query.ts apps/api/src/catalog/types.ts apps/api/src/catalog-types.ts apps/api/src/routes/v1.ts apps/api/src/catalog/catalog.test.ts apps/desktop/src/shared/catalog-dto.ts apps/desktop/src/shared/ranking-types.ts apps/desktop/src/main/catalog-client.ts apps/desktop/src/renderer/src/views/Discover.tsx
git commit -m "$(cat <<'EOF'
Page catalogue search from the last sort key instead of OFFSET.

EOF
)"
```

---

### Task 6: Look up posters only for titles on screen, and pace TMDb

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/services/tmdb-posters.ts`
- Modify: `apps/api/src/catalog/database.ts` (`listTitlesNeedingPosters`)
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/v1.ts` (rebuild handler)
- Test: `apps/api/src/services/tmdb-posters.test.ts`

**Interfaces:**
- Produces: `TMDB_POSTER_CONCURRENCY` default `2`
- Produces: `TMDB_POSTER_GAP_MS` default `300`
- Produces: `listTitlesNeedingPosters(limit, priorityIds, fillRest = false)`. `fillRest: false` returns only ids in `priorityIds` that still need media.
- `startPosterEnrichment(catalog, { ids })` still prioritizes those ids. `enrichPosters` calls `listTitlesNeedingPosters(..., false)` so it does not walk the rest of the catalogue.
- `findTitleMedia` awaits `delay(TMDB_POSTER_GAP_MS)` after each attempt, including a 429.
- `apps/api/src/index.ts` does not call `startPosterEnrichment(catalog)` after startup.
- `POST /v1/catalog/rebuild` does not call `startPosterEnrichment(db)` with no ids. `POST /v1/catalog/enrich-posters` and `GET /v1/titles/:id` still pass ids. Desktop Discover already posts the visible ids.

A missing TMDb key keeps today’s behavior: log once and return null. Visible rows stay on placeholders. That is the whole failure, not a catalogue-wide job.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/catalog/catalog.test.ts`:

```ts
test("poster candidates stay limited to the requested ids", () => {
  const catalog = openCatalog();
  seedTitle(catalog, { id: "tt0000001", title: "Shown", rating: 8, votes: 100 });
  seedTitle(catalog, { id: "tt0000002", title: "Hidden", rating: 8, votes: 90 });
  const rows = catalog.listTitlesNeedingPosters(50, ["tt0000001"], false);
  assert.deepEqual(rows.map((row) => row.id), ["tt0000001"]);
});
```

Add to `apps/api/src/services/tmdb-posters.test.ts`:

```ts
import { TMDB_POSTER_CONCURRENCY, TMDB_POSTER_GAP_MS } from "../config.js";

test("poster lookups stay at two workers with a gap", () => {
  assert.equal(TMDB_POSTER_CONCURRENCY, 2);
  assert.equal(TMDB_POSTER_GAP_MS, 300);
});
```

The concurrency test fails today because the default is `12` and `TMDB_POSTER_GAP_MS` does not exist. The candidate test fails because `listTitlesNeedingPosters` has no third argument and fills from the rest of the catalogue.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts src/services/tmdb-posters.test.ts`

Expected: FAIL because `listTitlesNeedingPosters` does not take `fillRest` and returns both ids, and `TMDB_POSTER_GAP_MS` is not exported.

- [ ] **Step 3: Implement**

```ts
export const TMDB_POSTER_CONCURRENCY = Math.max(
  1,
  Number(process.env.TMDB_CONCURRENCY) || 2,
);
export const TMDB_POSTER_GAP_MS = Math.max(
  0,
  Number(process.env.TMDB_POSTER_GAP_MS) || 300,
);
```

Change the signature:

```ts
listTitlesNeedingPosters(
  limit = 400,
  priorityIds: string[] = [],
  fillRest = false,
): Array<{ id: string; kind: string }>
```

When `fillRest` is false, return `prioritized` and do not run the `imdb_votes DESC` fill query.

In `enrichPosters`, pass `false` for `fillRest`. After every `findTitleMedia` call, `await delay(TMDB_POSTER_GAP_MS)` using `delay` from `work-queue.ts`.

Delete the unscoped `void startPosterEnrichment(catalog)` in `apps/api/src/index.ts` and the unscoped call in the rebuild route.

- [ ] **Step 4: Run the poster tests**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts src/services/tmdb-posters.test.ts`

Expected: PASS. The requested-id test returns only `tt0000001`. The config test sees concurrency `2` and gap `300`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/services/tmdb-posters.ts apps/api/src/services/tmdb-posters.test.ts apps/api/src/catalog/database.ts apps/api/src/index.ts apps/api/src/routes/v1.ts
git commit -m "$(cat <<'EOF'
Look up TMDb posters only for titles the user is viewing.

EOF
)"
```

---

### Task 7: Shorten catalogue write transactions and delay ANALYZE

**Files:**
- Modify: `apps/api/src/build/types.ts`
- Modify: `apps/api/src/build/import-basics.ts`
- Modify: `apps/api/src/catalog/work-queue.ts`
- Modify: `apps/api/src/catalog/database.ts` (pragma)
- Test: `apps/api/src/catalog/work-queue.test.ts`

**Interfaces:**
- Produces: `TITLE_BATCH` is `500`
- Produces: `ANALYZE_IDLE_MS` is `60_000`
- `importBasics` calls `yieldEventLoop()` from `work-queue.ts` after each `upsertTitleRows`
- `busy_timeout` pragma becomes `15000`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYZE_IDLE_MS } from "./work-queue.js";
import { TITLE_BATCH } from "../build/types.js";

test("title batches and ANALYZE stay off the search path", () => {
  assert.equal(TITLE_BATCH, 500);
  assert.equal(ANALYZE_IDLE_MS, 60_000);
});
```

Export `ANALYZE_IDLE_MS` from `work-queue.ts`. It is currently a private const.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/catalog/work-queue.test.ts`

Expected: FAIL because `ANALYZE_IDLE_MS` is not exported or `TITLE_BATCH` is `10000`.

- [ ] **Step 3: Implement**

```ts
export const TITLE_BATCH = 500;
```

```ts
export const ANALYZE_IDLE_MS = 60_000;
```

`queueIdleAnalyze` already waits `ANALYZE_IDLE_MS`. After each flushed batch in `importBasics`:

```ts
catalog.upsertTitleRows(batch);
batch = [];
await yieldEventLoop();
```

```ts
this.db.pragma("busy_timeout = 15000");
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=@rescore/api -- src/catalog/work-queue.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/build/types.ts apps/api/src/build/import-basics.ts apps/api/src/catalog/work-queue.ts apps/api/src/catalog/work-queue.test.ts apps/api/src/catalog/database.ts
git commit -m "$(cat <<'EOF'
Yield between title writes and postpone ANALYZE.

EOF
)"
```

---

### Task 8: Retry a failed credits import once, and say so in the inspector

**Files:**
- Modify: `apps/api/src/build/run-build.ts` (`buildCatalogCredits`)
- Modify: `apps/api/src/catalog/database.ts`
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/desktop/src/shared/catalog-status.ts`
- Modify: `apps/desktop/src/main/catalog-runtime.ts`
- Modify: `apps/desktop/src/renderer/src/components/inspector/index.tsx`
- Test: `apps/api/src/build/credits-retry.test.ts`

**Interfaces:**
- Produces: `shouldRetryCredits(attempt: number, creditsReady: boolean): boolean` — true only when `attempt === 0` and `creditsReady` is false
- Produces: `CatalogDatabase.setCreditsFailed(failed: boolean)` using meta key `creditsFailed`
- Produces: `CatalogStatus.creditsFailed?: boolean`
- On failure, `buildCatalogCredits` sets `creditsFailed`, waits 60 seconds, and runs `runBuildCredits` one more time when `shouldRetryCredits` is true. Success clears `creditsFailed` and sets `creditsReady`. A second failure leaves `creditsFailed` set and does not loop.
- Inspector copy when `creditsFailed` is true: `Credits could not be loaded. They will be tried again next launch.` The existing “Loading credits…” line stays only when `creditsReady === false` and `creditsFailed` is not true.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRetryCredits } from "./credits-retry.js";

test("credits retry once after a failure and not after success", () => {
  assert.equal(shouldRetryCredits(0, false), true);
  assert.equal(shouldRetryCredits(1, false), false);
  assert.equal(shouldRetryCredits(0, true), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/build/credits-retry.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

```ts
export function shouldRetryCredits(attempt: number, creditsReady: boolean): boolean {
  return attempt === 0 && !creditsReady;
}
```

In the `.catch` of `buildCatalogCredits`, call `catalog.setCreditsFailed(true)`. Then:

```ts
if (shouldRetryCredits(0, catalog.creditsReady())) {
  await delay(60_000);
  await runBuildCredits(catalog, false);
}
```

`runBuildCredits` already returns without throwing when it succeeds, and its `catch` currently rethrows. Keep the rethrow on the second failure. Clear `creditsFailed` in the success path next to `setCreditsReady(true)`.

Thread `creditsFailed` through health the same way Task 1 threads `titlesUpdateAvailable`.

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=@rescore/api -- src/build/credits-retry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/build/credits-retry.ts apps/api/src/build/credits-retry.test.ts apps/api/src/build/run-build.ts apps/api/src/catalog/database.ts apps/api/src/routes/health.ts apps/desktop/src/shared/catalog-status.ts apps/desktop/src/main/catalog-runtime.ts apps/desktop/src/renderer/src/components/inspector/index.tsx
git commit -m "$(cat <<'EOF'
Retry a failed credits import once and show the failure.

EOF
)"
```

---

### Task 9: Remove Discover filters the catalogue cannot answer

**Files:**
- Modify: `apps/desktop/src/shared/filters.ts`
- Modify: `apps/desktop/src/shared/search-history.ts`
- Modify: `apps/desktop/src/renderer/src/components/filter-panel/index.tsx`
- Delete: `apps/desktop/src/renderer/src/components/filter-panel/language-field.tsx`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Test: `apps/desktop/src/shared/filters.test.ts`

**Interfaces:**
- `DiscoverFilters` no longer has `keywords`, `providers`, or `language`.
- `defaultFilters()` no longer sets them.
- `LANGUAGES` is deleted with `language-field.tsx`. Nothing in `filter-panel/index.tsx` imports that file today; delete it anyway.
- Remove IPC `catalog:providers` and `catalog:searchKeywords` and the preload wrappers. Leave `catalog:searchPeople`; Task 10 implements it.
- Leave `KeywordRef` and `WatchProvider` on `MovieSummary` if other files still construct `keywords: []`. Do not add new UI for them.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters } from "./filters.js";

test("default discover filters do not advertise catalogue fields IMDb dumps lack", () => {
  const filters = defaultFilters() as Record<string, unknown>;
  assert.equal("keywords" in filters, false);
  assert.equal("providers" in filters, false);
  assert.equal("language" in filters, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=rescore -- src/shared/filters.test.ts`

Expected: FAIL because those keys are present.

- [ ] **Step 3: Delete the fields and the unused language control**

Remove the three fields from the interface and `defaultFilters`. Update `search-history.ts` so applying a saved search does not read or write them. Remove the preload and IPC handlers that always returned `[]` for providers and keywords. Delete `language-field.tsx`. Fix every TypeScript error from the removed fields by deleting the property, not by casting.

- [ ] **Step 4: Run the test and the web typecheck**

Run: `npm test --workspace=rescore -- src/shared/filters.test.ts`

Expected: PASS.

Run: `npm run typecheck:web --workspace=rescore`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/filters.ts apps/desktop/src/shared/filters.test.ts apps/desktop/src/shared/search-history.ts apps/desktop/src/renderer/src/components/filter-panel apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
Drop discover filters the IMDb catalogue cannot apply.

EOF
)"
```

---

### Task 10: Apply excluded genres, directors, and cast in the catalogue query

**Files:**
- Modify: `apps/api/src/catalog/query.ts`
- Modify: `apps/api/src/catalog/types.ts`
- Modify: `apps/api/src/routes/v1.ts`
- Modify: `apps/api/src/catalog/schema.ts` (new migration: `CREATE INDEX IF NOT EXISTS people_name_idx ON people(name)`)
- Modify: `apps/api/src/catalog/database.ts` (`searchPeople`)
- Modify: `apps/desktop/src/main/catalog-client.ts` (`discoverQuery`)
- Modify: `apps/desktop/src/main/ipc.ts` (`catalog:searchPeople`)
- Modify: `apps/desktop/src/renderer/src/components/filter-panel/index.tsx`
- Test: `apps/api/src/catalog/catalog.test.ts`

**Interfaces:**
- Produces: `TitleQuery.withoutGenres?: string[]`, `directors?: string[]`, `cast?: string[]` — values are display names, max 8 each
- Query params: `withoutGenre`, `director`, `cast`, each a comma-separated list, same preprocess as `genre`
- Excluded genre predicate:

```sql
NOT EXISTS (
  SELECT 1 FROM title_genres gx
  WHERE gx.title_id = t.id AND gx.genre IN (@withoutGenre0)
)
```

- Each director name is its own `AND EXISTS` on `title_people` joined to `people` with `tp.role = 'director'` and `p.name = @director0`. Cast uses `role = 'cast'`.
- Produces: `CatalogDatabase.searchPeople(query: string, role: "director" | "cast", limit = 8): Array<{ nconst: string; name: string }>`

```sql
SELECT p.nconst, p.name
FROM people p
JOIN title_people tp ON tp.nconst = p.nconst
WHERE tp.role = ? AND p.name LIKE ? || '%'
GROUP BY p.nconst
ORDER BY p.name
LIMIT ?
```

- `GET /v1/people?q=&role=director|cast` returns `{ data: Array<{ nconst: string; name: string }> }`
- Desktop `discoverQuery` maps `filters.withoutGenres` through the existing genre-id-to-name helper, and sends `filters.directors.map((person) => person.name)` and the same for cast.
- Filter panel: a second `GenreChips` labelled “Exclude” bound to `withoutGenres`. Choosing an excluded genre removes it from `genres`, and choosing an included genre removes it from `withoutGenres`. Two `SuggestField`s labelled “Directors” and “Cast” call `window.api.searchPeople`. `PersonRef.id` stays the existing name hash from `genreId`; the API filters on `name`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/catalog/catalog.test.ts`. `upsertTitles` writes genres and people; `insertTitleRows` does not.

```ts
test("excluded genres and people narrow the page", () => {
  const catalog = openCatalog();
  catalog.upsertTitles([
    {
      id: "tt0000001",
      title: "Horror One",
      kind: "movie",
      genres: ["Horror"],
      directors: ["Jane Doe"],
    },
    {
      id: "tt0000002",
      title: "Comedy Two",
      kind: "movie",
      genres: ["Comedy"],
      cast: ["Jane Doe"],
    },
  ]);
  const base = { page: 1, pageSize: 10, sort: "title" as const, order: "asc" as const, includeTotal: false };
  assert.deepEqual(
    catalog.listTitles({ ...base, withoutGenres: ["Horror"] }).data.map((row) => row.id),
    ["tt0000002"],
  );
  assert.deepEqual(
    catalog.listTitles({ ...base, directors: ["Jane Doe"] }).data.map((row) => row.id),
    ["tt0000001"],
  );
  assert.deepEqual(
    catalog.listTitles({ ...base, cast: ["Jane Doe"] }).data.map((row) => row.id),
    ["tt0000002"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts`

Expected: FAIL because those query fields are ignored and both titles return.

- [ ] **Step 3: Implement the predicates, the people route, and the filter controls**

Add the three optional arrays to `TitleQuery` and to `buildWhere` as specified above. Add the zod preprocess fields on `listQuery`. Add the people index as the next entry in the `schema.ts` migration list (do not edit an already-applied migration string; append a new one). Add `searchPeople` and `GET /v1/people`. Point `catalog:searchPeople` at that route. Update `discoverQuery` and the filter panel.

- [ ] **Step 4: Run the catalog tests and desktop typecheck**

Run: `npm test --workspace=@rescore/api -- src/catalog/catalog.test.ts`

Expected: PASS.

Run: `npm run typecheck --workspace=rescore`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/query.ts apps/api/src/catalog/types.ts apps/api/src/catalog/schema.ts apps/api/src/catalog/database.ts apps/api/src/routes/v1.ts apps/api/src/catalog/catalog.test.ts apps/desktop/src/main/catalog-client.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/src/components/filter-panel/index.tsx
git commit -m "$(cat <<'EOF'
Filter the catalogue by excluded genres and people.

EOF
)"
```

---

## Self-review

| Concern | Task |
| --- | --- |
| First build and forced rebuild are long and have looked frozen | Task 1 keeps a usable catalogue from entering that parse. Task 2 keeps the in-progress strip up if a forced rebuild is running. An empty first build still uses the full-page loader. |
| A fingerprint mismatch starts that rebuild while titles already exist | Task 1 |
| A dead or hung local API is its own outage | Task 3 |
| Page-1 `COUNT(*)` can hit the 4s search timeout | Task 4 |
| Infinite scroll uses `OFFSET` | Task 5 |
| One TMDb lookup per title, 12 at a time, 429s, and a missing key stalls new posters | Task 6 limits lookups to visible ids, concurrency 2, 300ms gap. A missing key still leaves placeholders and no longer starts a catalogue-wide job. |
| Ratings, posters, and `ANALYZE` share SQLite with search under a 5s busy timeout | Task 7 |
| A failed credits import leaves empty cast until some later run | Task 8 retries once in-process and the inspector states the failure. The next launch still retries because `creditsReady` stays false. |
| Keyword, provider, language, excluded-genre, cast, and director filters are never sent | Task 9 removes the three the dumps do not contain. Task 10 sends and applies the three the tables already store. |

Placeholder scan: every task has a test, a command, and the code that satisfies it. `probeRemote` is named as an existing function to export, not a new design.

Type names used throughout: `shouldDeferTitleIngest`, `titlesUpdateAvailable`, `shouldRestartHungChild`, `canLoadMoreFromPage`, `encodeTitleCursor` / `decodeTitleCursor` / `nextCursor`, `TMDB_POSTER_GAP_MS`, `TITLE_BATCH`, `ANALYZE_IDLE_MS`, `shouldRetryCredits`, `creditsFailed`, `withoutGenres`, `searchPeople`.
