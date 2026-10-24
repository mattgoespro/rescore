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
