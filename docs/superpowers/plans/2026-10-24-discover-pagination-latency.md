# Discover pagination latency

## Cause

Every Discover page after the first carried a keyset predicate shaped as an OR across the leading sort column, for example `(votes < @v OR votes IS NULL) OR (votes = @v AND id > @id)`. SQLite ran it as a MULTI-INDEX OR: it collected every remaining match, ran the language and Library `NOT EXISTS` probes on each, sorted them in a temp B-tree, then kept 40. A second "is there more?" query repeated the predicate. Rating and year sorts had no index in result order, so even their first page scanned and sorted. The renderer requested a page only once the list reached its end, so the user waited out the whole query. The live service measured 0.9–1.5 s per cursor page.

## Change

1. `apps/api/src/catalog/query.ts`: the keyset is split into ordered segments, each one index range (`lead <= @v AND (lead < @v OR tie)`), with NULLs in the leading column as a trailing segment read only when the bounded one runs short.
2. The same file fetches `pageSize + 1` rows instead of running a separate peek query.
3. `apps/api/src/catalog/schema.ts` adds `titles_kind_rating_idx` and `titles_kind_year_idx`. Under a `kind` filter, `listTitles` names the index that matches the sort (`INDEXED BY`), because the planner otherwise picks by filter selectivity, with or without `ANALYZE`. FTS searches now `CROSS JOIN` from `titles_fts`: the new indexes otherwise led the planner to walk titles and re-run MATCH per row (72 s per page).
4. `apps/desktop/src/renderer/src/lib/discover-results.ts` requests the next page as soon as its cursor arrives, and `loadMore` appends it without a round trip. A filter change discards it, and a failed prefetch is retried on demand.

## Benchmark

The harness drives the real Express app (`createApp`) over HTTP with the query strings `discoverQueryParams` builds from the desktop's default filters. Database time is `listTitles` timed in the same process. The data is a copy of the service catalogue snapshot from 2026-10-14 (484,727 titles), with the FTS index rebuilt and 300 watched plus 60 watchlist Library rows. Each case loads page 1 and then 5 cursor pages. One warm-up round is discarded, then 5 rounds are measured. Figures are medians. The pre- and post-change runs returned identical ID sequences for every case.

| Demo case | Page 1 HTTP before → after | Next page HTTP before → after | Change (next page) | Next page DB before → after | Change (DB) | Worst next page before → after |
|---|---|---|---|---|---|---|
| Default: Best match | 22.5 → 17.6 ms | 323.6 → 15.2 ms | −95.3% | 309.9 → 4.3 ms | −98.6% | 367 → 22 ms |
| Sort by IMDb rating | 320.9 → 16.2 ms | 310.2 → 15.4 ms | −95.0% | 300.9 → 4.8 ms | −98.4% | 386 → 19 ms |
| Newest first | 329.0 → 17.2 ms | 311.7 → 15.4 ms | −95.0% | 309.2 → 7.0 ms | −97.7% | 412 → 23 ms |
| Oldest first | 316.9 → 15.0 ms | 318.3 → 15.7 ms | −95.1% | 311.5 → 2.8 ms | −99.1% | 390 → 19 ms |
| Popularity + Horror | 23.5 → 19.6 ms | 288.0 → 128.7 ms | −55.3% | 285.7 → 121.9 ms | −57.3% | 429 → 203 ms |
| Drama minus Romance, 1990–2010, by rating | 303.1 → 17.2 ms | 311.4 → 15.2 ms | −95.1% | 297.4 → 5.2 ms | −98.2% | 403 → 23 ms |
| TV series by rating, any year | 102.4 → 16.2 ms | 107.7 → 15.2 ms | −85.8% | 94.7 → 5.1 ms | −94.6% | 124 → 21 ms |
| Mini-series, newest first | 13.7 → 16.6 ms | 29.6 → 15.5 ms | −47.6% | 17.4 → 4.9 ms | −71.9% | 41 → 24 ms |
| Wide open: all movies by rating | 1726.0 → 15.0 ms | 1652.2 → 15.7 ms | −99.1% | 1650.4 → 1.3 ms | −99.9% | 1817 → 30 ms |
| Text search "star" | 35.0 → 32.9 ms | 39.6 → 34.5 ms | −12.7% | 30.4 → 22.8 ms | −25.0% | 58 → 44 ms |

About 10 ms of each HTTP figure is Express, JSON, and hydration, which is now the floor. The first service start after this change builds the two indexes once (catalogue open went from 0.3 s to 1.8 s on this snapshot). Popularity + Horror remains the slowest case: Horror is sparse, so the votes-ordered walk inspects many titles per page. Prefetch hides that in the app.

## Round two: genre mask, wider votes index, For You index

**HTTP client.** The 15 ms floor in the first benchmark came from Node 24's `fetch` on Windows, which the harness ran on. Inside Electron 39 (Node 22.21), `fetch` measured 0.53 ms on an empty endpoint against 0.37 ms for a keep-alive `node:http` agent, and 2.12 against 1.99 ms for a Discover page. The desktop client keeps `fetch`. The round-two harness uses a keep-alive `node:http` agent so its HTTP figures match Electron.

**Change.**

- `titles.genre_mask` holds one bit per genre, assigned in `genre_bits`. Bits are capped at 53 so a mask stays exact as a JS number.
- Triggers on `title_genres` keep the mask current. Bulk loads drop the triggers and rebuild the masks in `endBulkLoad`, as they do for FTS.
- Genre and excluded-genre filters test the mask. They fall back to `title_genres` when a stored genre has no bit.
- `titles_kind_votes_desc_idx` becomes `titles_kind_votes_cover_idx (kind, imdb_votes DESC, year, imdb_rating, genre_mask)`, so the vote, year, rating and genre filters are checked from the index.
- `titles_votes_desc_idx (imdb_votes DESC, id)` serves For You, which ranks every kind by votes.

**Benchmark.** Same data and method as above, plus a For You case and two more genre cases. Each figure is the mean of two full runs' medians, and every run returned identical ID sequences. Run-to-run noise on the unchanged cases is ±2–3 ms.

| Demo case | Page 1 before → after | Change | Next page before → after | Change | Next page DB before → after |
|---|---|---|---|---|---|
| Default: Best match | 9.4 → 7.3 ms | −22% | 6.3 → 5.0 ms | −20% | 5.3 → 3.9 ms |
| Sort by IMDb rating | 6.2 → 4.5 ms | −27% | 6.5 → 4.7 ms | −28% | 5.3 → 3.9 ms |
| Newest first | 6.7 → 6.5 ms | −3% | 7.1 → 6.1 ms | −14% | 6.3 → 5.3 ms |
| Oldest first | 3.4 → 2.9 ms | −16% | 3.4 → 3.1 ms | −9% | 2.6 → 2.5 ms |
| Popularity + Horror | 15.1 → 2.7 ms | −82% | 127.3 → 3.5 ms | −97% | 126.6 → 2.9 ms |
| Best match + Western (13 titles) | 299.1 → 4.0 ms | −99% | — | — | — |
| Best match minus Drama and Romance | 10.4 → 5.5 ms | −47% | 9.0 → 4.3 ms | −53% | 7.9 → 3.6 ms |
| Drama minus Romance, 1990–2010, by rating | 9.2 → 7.9 ms | −14% | 7.5 → 6.0 ms | −20% | 6.5 → 5.2 ms |
| TV series by rating, any year | 5.5 → 5.9 ms | +8% | 6.4 → 6.7 ms | +5% | 5.3 → 5.9 ms |
| Mini-series, newest first | 7.7 → 7.3 ms | −5% | 6.4 → 6.2 ms | −3% | 5.6 → 5.4 ms |
| Wide open: all movies by rating | 1.8 → 1.5 ms | −19% | 1.8 → 1.5 ms | −16% | 1.2 → 1.0 ms |
| Text search "star" | 28.3 → 23.5 ms | −17% | 24.0 → 24.5 ms | +2% | 23.2 → 23.7 ms |
| For You candidates (80) | 435.4 → 352.7 ms (DB 123.7 → 7.5 ms) | −19% (DB −94%) | — | — | — |

The TV series, Mini-series and text-search cases touch neither the genre mask nor the votes index. Their deltas are within run-to-run noise.

The first open after this change runs the migration once: the mask backfill and two indexes took the catalogue open from about 2 s to 7–8 s on this snapshot.

For You's remaining ~345 ms is `listLibrary`: 275 ms for 360 Library entries, against 0.8 ms to serialise them. Facets are cached.

## Round three: Library list

**Cause.** `listLibrary` joined `library_entries` to `titles` with a plain `JOIN`. `sqlite_stat1` held row counts for `titles` (484,727) but none for `library_entries`, because ANALYZE last ran while the library was empty. Without a figure, the planner assumed the library was large and made `titles` the outer loop: it scanned every title (`SCAN t`) and probed for a library entry. The `status=` variant estimated fewer rows and already read the library first.

The full list is read by the Library view, by For You, by the desktop taste cache, and after every library write (`upsert` and `remove` return it).

**Change.** `libraryListSql` uses `library_entries l CROSS JOIN titles t`, which keeps the library as the outer loop whatever the statistics say. It also breaks `updated_at` ties on `title_id`, so the order no longer depends on the plan. A test runs ANALYZE before saving any library rows and asserts the plan starts with `SCAN l`; it fails with a plain `JOIN`.

**Benchmark.** Harness v3 adds two Library cases, and its For You database figure sums every catalogue call in the request. Each figure is the mean of two runs' medians. The post-change Library lists hold the same titles as before; with the tie-break they are in a stable order.

| Demo case | Before | After | Change | DB before → after |
|---|---|---|---|---|
| Library list (all 360 entries) | 283.1 ms | 38.6 ms | −86% | 280.2 → 34.3 ms |
| For You (library, facets, 80 candidates) | 292.1 ms | 48.7 ms | −83% | 286.2 → 43.7 ms |
| Library list, watched only (300) | 25.0 ms | 31.1 ms | +25% | 22.6 → 27.9 ms |

The watched-only list already used the faster plan, so its change is noise. A third run on the final code measured 28.1 ms.

The Discover cases ran 10–35% slower in this round's post runs although no Discover code changed. This is session-to-session drift on this machine: text search, untouched since round one, ranged 22–30 ms. Single-digit-millisecond differences in these tables are within noise.

What remains of the Library list's time is hydrating 360 titles, attaching their genres, people and languages: about 30 ms.

## Round four: common-word text search

**Cause.** A text search drove from the full-text hits (`titles_fts f CROSS JOIN titles t`), so every hit was fetched, filtered and sorted before the first page could be taken. A common word or a first letter matches a large part of the catalogue: "the" has 98,927 hits and "s" has 129,811. Search runs while the user types (400 ms debounce), so the first searches someone sees are the slowest.

**Change.** When the sort has a matching index under a `kind` filter, `buildWhere` counts the hits up to `FTS_SET_THRESHOLD` (2,000). If the threshold is reached, the match becomes `t.rowid IN (SELECT rowid FROM titles_fts WHERE titles_fts MATCH @fts)`. SQLite builds that set once and walks the sort index, stopping at the page. Below the threshold, the search keeps the `CROSS JOIN`, which is faster when hits are few: the index walk crosses the whole index to find them (about 13 ms for a word with no hits). Measured per word, the two strategies cross between roughly 1,000 and 3,000 hits; at 2,000 either one is within about 3 ms of the other. The bounded count costs about 0.3 ms, or 19 ms for a single letter, where FTS expands the prefix either way.

A test seeds more titles than the threshold. For a common word, a rare word and an absent word, it checks that cursor-paged results match across both strategies for votes, rating and year in both directions, with a watched title hidden. With the set filter inverted, the test fails.

**Benchmark.** Same harness, plus nine search cases using the default Discover filters. Each figure is the mean of two runs' medians, and every run returned identical ID sequences.

| Demo case | Matches | Page 1 before → after | Change | Next page before → after | Change |
|---|---|---|---|---|---|
| Typing search "s", Best match | 129,811 | 245.4 → 57.5 ms | −77% | 245.6 → 58.0 ms | −76% |
| Search "the", Best match | 98,927 | 210.7 → 22.9 ms | −89% | 214.3 → 22.3 ms | −90% |
| Search "the", by IMDb rating | 98,927 | 216.8 → 25.9 ms | −88% | 212.0 → 22.8 ms | −89% |
| Search "love", Best match | 9,023 | 44.2 → 4.8 ms | −89% | 42.8 → 4.5 ms | −89% |
| Search "love", newest first | 9,023 | 49.7 → 12.2 ms | −75% | 51.5 → 18.8 ms | −64% |
| Search "night", Best match | 3,772 | 25.9 → 4.7 ms | −82% | 25.6 → 2.7 ms | −90% |
| Text search "star", no floors | 2,369 | 21.8 → 6.0 ms | −72% | 22.2 → 6.2 ms | −72% |
| Search "dark", Best match (join kept) | 1,913 | 3.3 → 3.4 ms | noise | — | — |
| Search "matrix" (join kept) | 23 | 0.6 → 0.9 ms | noise | — | — |
| Search "zzyzx", no matches (join kept) | 0 | 0.7 → 0.6 ms | noise | — | — |

The non-search cases moved by under 1 ms in either direction; their code path is unchanged. "s" still costs about 57 ms, most of it FTS expanding a one-letter prefix twice: once to count, once to build the set. An FTS5 `prefix=` index would cut that, at the cost of a full-text rebuild and more disk.
