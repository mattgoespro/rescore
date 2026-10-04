# Catalogue leftovers

Six deepenings. Each one puts a decision behind a small interface so callers stop re-deriving it. Locked behaviour from earlier passes stays locked.

## Status snapshots

A catalogue status change names `phase` and `message`, plus any field that actually changes. Counts, flags, and poster hydration already on the status stay. A restart, recover, rebuild, or error must not drop `tmdbHydration`, `titlesReady`, or `creditsReady`. Phase `building` still blocks the shell.

Health remains a full read: fields the health payload carries replace the previous ones. A hydration event names the current phase and message and replaces only `tmdbHydration`.

## Taste

Every Library write drops the cached taste, including a ratings CSV import. Discover match re-rank and For You personal re-rank share one readiness rule with `publicProfile.ready`: three rated titles. Below that, For You keeps catalogue order. `loadDiscoverSlice` still owns the cursor, the page size of 40, match re-rank, and `canLoadMore`.

## Library write

`saveLibrary`, `deleteLibrary`, and `clearLibrary` return the rows the write affected. They do not list and hydrate the whole Library to produce one row. Clear is one delete. The desktop clear handler still hands the view an empty Library, because the view replaces its list with that result and a clear leaves none. Title ingest and credits writing stay separate.

## Title read

`GET /titles/:id` returns the title and does not enqueue poster hydration. Fill, the open title, and the background pass enter the existing coordinator through one admission. The scheduler, key pool, and coordinator stay one. The pending hydration SQL stays. Poster-fill helpers and the list observer stay.

## Discover total

A Discover page is titles, a cursor, and whether another page exists. When the total was not counted and the page is full, the total is unknown. Unknown is not a number. The view does not print an unknown total, or the loaded page length, as the catalogue size. A short page has an exact total only when it was not reached through a cursor. A cursor forces offset 0, so a later short page stays unknown. `discoverQueryParams` and `loadDiscoverSlice` stay the owners of the query record, the cursor, the page size of 40, match re-rank, and `canLoadMore`. The client does not keep a second `canLoadMore` definition.

## Library visibility

One module turns a list kind plus hide flags into the Library statuses to exclude. Discover always excludes skipped, and also watched or watchlist when those flags are set. For You excludes watched and skipped, and does not exclude watchlist. The For You vote floor stays 5000. `ratingMax` stays as it is. For You personal re-rank stays outside the catalogue.
