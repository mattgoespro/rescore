# Outstanding catalogue work

Follow-on to `docs/superpowers/specs/2026-10-03-catalogue-deepening.md`. Each phase ships alone.

## Rating ceiling

Discover's `ratingMax` is a catalogue filter. `imdb_rating <= ratingMax`. A title with a null rating stays in the result. `ratingMax` of 10 is the top of the scale and is not sent. `ratingMin` is unchanged.

## Rebuild windows

Title ingest and credits writing each run inside one function. The caller does not call start, finish, and abort itself.

`withTitleIngest` starts the ingest, runs the work, finishes on success, and aborts on throw.

`withCreditsWrite` marks credits in progress, starts the credits window, runs the work, and on success finishes, sets the credits flag, and clears `creditsFailed`. On throw it finishes, leaves the flag unset, and clears in-progress. Dump fingerprints and `queueAnalyze` stay with the caller. Title ingest and credits writing stay separate calls.

## Browse facts

`isCatalogUsable` does not take `tmdbReady`. Browsing still requires titles, the credits flag, and `creditsFailed !== true`. Health `ready` stays `catalogHealthReady` and still ignores TMDb. Phase `building` still blocks the shell.

## Poster refresh

Visible rows and the open title share one fill decision: skip ids already resolved, skip ids whose retry time is still in the future, take at most 40, and treat `hydrationComplete` as resolved. Retry delay is 30 seconds. Completed hydration ids clear a pending retry. The open title still reloads its details. The list observer stays in the list hook.

## Catalogue process

One decision: when the Windows service owns the catalogue, an unreachable process is refused and the catalogue URL cannot change. Otherwise the desktop may spawn. Health identity checks stay where they are.
