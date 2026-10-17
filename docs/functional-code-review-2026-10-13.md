# Functional code review — 2026-10-13

**Remediation:** all eleven findings are now addressed. See [implemented fixes and current verification](functional-fixes-2026-10-13.md). The findings and results below preserve the original review evidence.

Reviewed the current working tree, including uncommitted changes, across the API, catalogue ingestion/query/hydration, library persistence, desktop IPC and lifecycle, ranking, CSV import, settings, and renderer flows. Findings apply to the current codebase, rather than only the preceding UI changes. No application code was modified during this review.

**Assessment: changes required.** Eleven functional defects: one P1 and ten P2. Eight were reproduced with isolated fixtures; three were confirmed by tracing complete code paths. Prioritize library preservation first.

## Findings

### 1. P1 — Rebuilding can delete saved ratings and library entries

Location: `apps/api/src/catalog/rebuild.ts:208`; related foreign key: `apps/api/src/catalog/schema.ts:18`.

`finishTitleIngest` deletes every title missing from `ingest_seen`. The library foreign key cascades those deletions. Accepted input excludes titles without a rating, adult titles, and unsupported kinds, so an IMDb change can remove a previously saved title. This violates the rebuild promise that ratings, watchlist, and skips are kept.

Reproduced: save a watched title rated 9 and a second watchlist title; reconcile a dump containing only the second title. The watched entry and its rating disappear from the library.

Suggested change: retain title snapshots referenced by the library, or decouple library persistence from catalogue-row deletion. Validate unexpectedly empty/truncated ingests before committing removals. Add a regression test for a saved title absent from the next dump.

### 2. P2 — “Watched” fails for an unrated title

Location: `apps/desktop/src/main/catalog-client.ts:204`; validation: `apps/api/src/routes/v1.ts:182`; trigger: `apps/desktop/src/renderer/src/components/inspector/actions.tsx:36`.

The button supplies `undefined` when there is no score. The desktop serializes this as `personalRating: null`, which the API rejects for watched entries. The UI reports a catalogue-service failure even while the service is healthy.

Reproduced with the real client and API route: `saveLibrary(movie, "watched")` returns HTTP 400; omitting the rating property returns HTTP 200.

Suggested change: align the contract for watched-without-rating. For the current API contract, send `{ status, ...(rating === undefined ? {} : { personalRating: rating }) }`.

### 3. P2 — Library reads overwrite the user's update timestamp

Location: `apps/api/src/catalog/query.ts:423`; consumer: `apps/desktop/src/main/ranking.ts:142`.

`SELECT l.updated_at,t.*` selects two columns called `updated_at`. The title column overwrites the library column in the returned row. `listLibrary` therefore exposes catalogue-update time as the user's activity time. Recent-watch ranking and equal-rating Library ordering use the wrong dates.

Reproduced: saving returned the current timestamp; listing the same entry returned the title's deliberately old `2001-01-01` timestamp.

Suggested change: alias the library column, e.g. `l.updated_at AS library_updated_at`, and map the library DTO from that alias. Test with distinct catalogue and activity timestamps.

### 4. P2 — Search and For You keep titles after they become ineligible

Locations: `apps/desktop/src/renderer/src/views/Discover.tsx:99`, `apps/desktop/src/renderer/src/views/ForYou.tsx:66`, and their props in `App.tsx`.

Successful library writes update App's library/profile, but Discover reloads only when filters change and For You reloads only when ranking mode changes or Refresh is clicked. Neither view reconciles its loaded results with the new library. Rated/watched or skipped titles remain visible, and match/profile snapshots stay stale.

Reproduced in the current renderer: rating Alpha left it in Search with Hide watched checked and no new search request; rating Beta left it in For You without a new ranking request.

Suggested change: propagate library/ranking revisions, invalidate dependent data, and immediately reconcile exclusion rules for mounted rows. Preserve selection and scroll where possible.

### 5. P2 — Service recovery does not clear the desktop's error state

Location: `apps/desktop/src/main/catalog-runtime.ts:343` and `:376`.

The watcher publishes an error when the external Windows service becomes unavailable. Once health succeeds again, it clears counters and continues, without publishing recovered readiness or restarting the settling poll. Hydration events preserve the existing phase, so they cannot clear the error either. The UI stays blocked until Retry or restart.

Reproduced with the actual runtime module and isolated service boundaries: ready → unavailable → three successful health reads still left `phase: "error"`.

Suggested change: reconcile and publish health/readiness after recovery; resume hydration subscriptions as needed. Cover ready → failure → automatic service recovery.

### 6. P2 — An in-flight taste read can undo cache invalidation

Location: `apps/desktop/src/main/taste-cache.ts:11`.

`drop()` clears only the current value. A load already awaiting a library read can finish after a write invalidates the cache and then store the older result. Subsequent Discover match requests reuse that stale profile until another write. Changing catalogue clients also does not invalidate this cache.

Reproduced: start a delayed read, call `drop`, resolve the old read, then read again. The second read returned the pre-write value without invoking its new loader.

Suggested change: use a generation/version check around loads, deduplicate concurrent loads, and invalidate on catalogue identity changes. For example, publish a completed load only when its captured generation equals the current generation.

### 7. P2 — Interrupted downloads permanently poison the image cache

Location: `apps/api/src/routes/media.ts:35` and `:65`.

Downloads write directly to the final cache filename. If the upstream stream fails, the partial file remains. Later requests treat its existence as a valid cache hit and return HTTP 200 with immutable caching, without retrying the upstream. Concurrent requests can also read the unfinished file.

Reproduced: an upstream stream wrote four bytes and failed. The first response was 502; the next response was 200 with those four bytes, and no second upstream request occurred.

Suggested change: write to a unique temporary file, validate completion, atomically rename it into place, and remove temporary files on failure. Deduplicate downloads for the same cache key.

### 8. P2 — The ninth excluded genre breaks Search

Locations: `apps/desktop/src/renderer/src/components/filter-panel/index.tsx:55`, `apps/api/src/routes/v1.ts:56`.

The UI permits arbitrary genre exclusions, while the API accepts at most eight. Selecting a ninth ordinary genre makes the entire search fail with “Invalid request”; the UI does not explain the limit.

Reproduced against the route: eight exclusions return 200; nine return 400.

Suggested change: use one shared limit or allow all available catalogue genres. If retaining the limit, enforce and explain it before submitting the request.

### 9. P2 — Saving Region does not change catalogue behavior

Locations: `apps/desktop/src/main/ipc.ts:108`, `apps/api/src/services/service-environment.ts:46`, `apps/api/src/services/tmdb-posters.ts:622`, `apps/api/src/catalog/database.ts:526`.

Code-path finding: settings changes persist locally and fetch genres, but do not update the running service's configuration or `CATALOG_REGION`. A normal healthy service launch also skips maintenance. Already stored certifications are only updated while NULL, so even a later region change cannot replace certificates already cached for the previous region.

Suggested change: define the region contract for the shared service and propagate supported changes through the API. Store regional certificates separately or invalidate the appropriate certificate cache. Otherwise remove the unsupported setting.

### 10. P2 — CSV import discards rating dates

Locations: `apps/desktop/src/main/csv.ts:38`, `apps/desktop/src/main/ipc.ts:451`, `apps/api/src/catalog/database.ts:318`, `apps/desktop/src/main/ranking.ts:142`.

Code-path finding: the parser reads `Date Rated`, but import passes only movie, status, and score. Persistence assigns import time and returns no watched/rated date. The ranking model subsequently treats historical imported films as recent watches in import order. This remains incorrect after fixing finding 3.

Suggested change: preserve a validated imported activity date through IPC, the API, storage, and DTOs, and use it for recent-watch ranking. Test a CSV whose row order differs from date order.

### 11. P2 — “IMDb ratings API” is a nonfunctional setting

Locations: `apps/desktop/src/renderer/src/views/Settings.tsx:509`, `apps/desktop/src/main/ipc.ts:108`, `apps/desktop/src/main/imdb-ratings.ts:14`.

Code-path finding: `imdbApiUrl` is displayed, validated, and saved, but no active request path reads it. `ImdbRatingsClient` and `ratingsApiUrl` are not called anywhere. Ratings displayed by the UI come from the catalogue client instead. Changing this field has no effect.

Suggested change: remove the obsolete control and setting, or connect it to an explicitly supported rating lookup path without crossing the API networking boundary.

## Verification and limits

- API: **111/111 tests pass** (`npx tsx --test --test-timeout=30000 src/**/*.test.ts`).
- Desktop: **75/75 tests pass** through the workspace test script.
- Both workspace TypeScript checks and the desktop production build pass.
- The non-elevated Windows lifecycle fixture passes, including migration, relocation, rollback, preservation/deletion, missing registration/runtime, and linked-path rejection.
- Eight additional defect reproductions used temporary SQLite databases, mocked upstream streams, isolated IPC fixtures, or the actual runtime module bundled with service-boundary stubs.
- An isolated real Electron window exercised the current main-process close handling: Keep Editing preserved the window without shutdown; Discard Changes called shutdown and exited. Native dialog choices were stubbed. This is not installed-app acceptance or a real SCM test.
- No real library, settings, service installation, or catalogue downloads were changed. No elevated install/uninstall, reboot, or cross-user acceptance was performed.

The passing tests are useful but miss the cross-layer cases above: the existing library-write tests use same-time title/library creation, cache tests invalidate only completed loads, and browser fixtures do not exercise real API validation. The code's parameterized queries, authenticated service boundary, SQLite ownership lock, and staged service rollback are sound foundations; the confirmed lifecycle fixture checks also pass.

No author clarification is needed to act on these findings. No style-only findings are included.
