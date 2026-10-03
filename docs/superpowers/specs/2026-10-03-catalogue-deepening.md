# Catalogue deepening

Decisions for the working tree as of 2026-10-03. Each phase ships on its own. Later phases do not require earlier ones.

## Credits readiness

`creditsReady` is the `creditsReady` meta flag and nothing else. A `title_people` row does not make credits ready. That includes a licensed overlay person (`personKey`, `ex:` plus the name) and a partial credits write that inserted people before the flag was set.

`titlesReady` stays `titleCount > 0` and a stored `builtAt`. Title ingest and credits ingest stay separate calls. Search is allowed to exist before credits finish; the shell already treats `catalogUsable !== true` as blocked, and `isCatalogUsable` already requires the credits flag. Do not merge the two rebuilds into one call.

Setting the flag with `setCreditsReady(true)` makes credits ready even when `title_people` is empty.

## Overlay

`TMDB_HYDRATION_PENDING_SQL` is the pending rule: `poster_url`, `synopsis`, or `certification` is NULL, or `languages_checked` is not 1. `''` is a durable miss. Do not split that SQL, and do not split the TMDb scheduler, key pool, or hydration coordinator.

`titleNeedsMedia` uses that SQL, so it is already true when only languages are unchecked. The coordinator branch that fetches languages only after `titleNeedsMedia` is false is unreachable. Delete that branch. `complete` for a hydration job is `!titleNeedsMedia(id)`. Keep `titleNeedsLanguages` on the catalogue database; catalogue tests still read it.

## Movie

One function maps a catalogue title to `MovieSummary`. Discover, title details, Library, and For You all use it. Kind rule, unchanged: lowercased `kind`; if it contains `mini`, `miniseries`; else if it contains `tv` or `series`, `tv`; else `movie`. `mediaType` is `movie` only for title kind `movie`, otherwise `tv`. `imdbId` is lowercased. Null rating and votes become 0. Null synopsis becomes `""`. Certification `""` becomes omitted. `genreId` is the existing hash (start 7, `* 31 + char`, unsigned) and moves next to this function. Ranking stays in `ranking.ts`.

## Discover

Page size is 40, one constant, used as both `pageSize` and `limit`. `ratingMax` is not a catalogue query parameter. Do not add it to SQL in this work. `includeTotal` stays `"false"`. Sort mapping stays: `vote_average` → `rating`; `vote_count` or `popularity` → `votes`; `release_date` → `year`; `match` → `votes`; otherwise `title`. Order stays: `.asc` → `asc`; bare `title` → `asc`; otherwise `desc`.

The next slice replaces or appends. Replace sends a null cursor. Append sends the stored cursor. Page on the wire stays 1. Best-match re-rank runs only when `sortBy` is `match` and rated count is at least 3, and only on the new page. Under 3 rated titles, catalogue order stands. `canLoadMore` is `results.length >= 40 && nextCursor !== null`. The view reads `canLoadMore` from the result. It does not keep its own 40.

## Shell

Phase `building` blocks the shell, including when `catalogUsable` is true. That is locked by `catalog-busy.test.ts`. Do not unblock a rebuild. The inline rebuild strip in `App.tsx` is `!catalogBusy && rebuildFeedback`, which cannot render. Delete it. Settings keeps `catalogRebuildFeedback` for the Rebuild button while a build is in progress.

## Settle

`pollUntilSettled` must pass the probed port into the same decision `shouldSpawnReplacement` already encodes. An open port and a dead child resets the miss count and does not throw. A dead child, a closed port, and 8 misses throws `Catalog API became unreachable.` A live child does not give up on this path. Hung-child restart (3 misses, kill, then recover) stays in `watchApi`. `planApiLaunch` stays. Do not delete `shouldTerminateCatalogApi`.

## Out of scope

One combined title-and-credits rebuild. A port in front of catalogue query. An in-memory catalogue. Unblocking the shell during `building`. Adding `ratingMax` to SQL. Splitting poster fetch. Hydration-event or Windows-service ownership changes.
