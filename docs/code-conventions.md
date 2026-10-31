# Code conventions

Six review passes over `main` kept finding the same kinds of defect. This page lists each kind, with the rule and the existing helper or pattern to reuse. `npm run check` enforces what a tool can catch. The rest is for whoever writes or reviews a change.

## Enforced by `npm run check`

`check` runs lint with zero warnings, the Prettier check, both typechecks and both test suites.

| Guard                                             | Where                                      | Stops                                                          |
| ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| No `setInterval` in the renderer                  | `eslint.config.mjs`                        | Polling while the window is hidden                             |
| `<button>` needs `type`; no headings in buttons   | `eslint.config.mjs`                        | Accidental submits, a broken heading outline                   |
| No hex, `rgb()`, `hsl()` or `oklch()` in renderer | `eslint.config.mjs`                        | Colours that ignore the light and dark themes                  |
| "catalogue" in prose, no U+FFFD                   | `eslint.config.mjs`                        | Spelling drift and broken characters in text people read       |
| React hook rules and effect dependencies          | `eslint-plugin-react-hooks`                | Stale closures, effects that run too often or not at all       |
| Hot query plans                                   | `apps/api/src/catalog/query-plans.test.ts` | Full table reads and sort-everything plans on the titles table |

Do not silence a guard. If one is wrong for a case, narrow the rule in `eslint.config.mjs` with a comment saying why.

## Memory

Anything that outlives one request or render has a cap and evicts its oldest entries. Use a `Map` with delete-then-set for recency. Examples are `CountCache` (API, 500 totals), `DETAILS_CACHE_LIMIT` (60), `MEDIA_CACHE_LIMIT` (800), `PRIORITY_LIMIT` (2,000) and the 1 GB poster cache.

Bookkeeping about cached entries shrinks with the cache. When `mergeMediaRows` drops a row, its `resolved` id goes too. Delete expired backoffs when you read them.

## Async ordering

A result can arrive after its inputs changed. In effects, set a `current` or `cancelled` flag in cleanup and check it before `setState`, as `suggest-field` does. For repeated requests, keep a generation counter so only the newest lands, as `refreshProfile` and the results stores do.

Long operations are single-flight. A second call joins the running one (`importing ??=` in `ipc.ts`, `inflight` in `ensure-catalog.ts`). Never start a duplicate.

Follow-up work, such as reloading the taste profile, must not hold a busy state that blocks the user's next action.

## Redundant work and redraws

A `setState` that changes nothing keeps the same value, so React skips the render. Use `keepMenuPosition`, `sameCatalogView`, `mergeMediaRows` and the status snapshot as models.

- Measure the DOM at most once a frame (`requestAnimationFrame`), as `overlay-scroll` and `use-visible-media` do.
- Throttle anything that fires per item across IPC. Import progress goes out at most every 100 ms, and the last update always goes out.
- Compute a value once per path and pass it on. Don't query it again: `HydrationStats` goes from the enrichment loop to the publisher.
- Cache stable reads for a bounded time: coverage for 10 s, facets for 10 min, and taste inputs until the next library write.
- Renderer polling uses `pollWhileVisible`. Starting a process (PowerShell) costs about 300 ms, so poll it only while the view that shows it is visible.

## SQL on the titles table

The catalogue has about half a million titles, so a full table read or sorting every match costs tens to hundreds of milliseconds.

- Walk an index in result order and stop at `LIMIT`. Name the index (`INDEXED BY`) where the planner lacks statistics, and name each `kind` so every kind is one range.
- When a filter matches thousands of rows, pick ids from a covering index first, then read only those rows.
- Write count predicates to match a partial index exactly (`TMDB_HYDRATION_PENDING_SQL`).
- Use `CROSS JOIN` to keep a small table (the library, full-text hits) as the outer loop.
- Measure on a real catalogue before and after. Open `apps/api/data/catalog.sqlite` read-only and check `EXPLAIN QUERY PLAN` and timings, warm and cold. Add any new hot query to `query-plans.test.ts`.

## React

- Memoise derived lists that feed virtual lists or heavy children.
- For "when X happens, read the latest Y", use `useEffectEvent`, not a dependency list with things missing.
- A view clears only the error it raised itself (the `reportedError` ref).
- Controls that keep focus during a save use `aria-disabled` and ignore input; `disabled` drops keyboard focus.

## UI and copy

- Reuse the primitives in `lib/ui.ts` (`btn`, `iconBtn`, `segmentedCell`, `rankedRow`), along with `Popover` and `Select`. Section labels use `kicker`. Don't add one-off sizes, tracking or radii next to an existing style.
- Check both themes. A new token in `styles/theme.css` gets a light value unless it reads the same on both.
- Anything that looks interactive does something.
- Text says what the code does. When behaviour changes, change the sentence that describes it in the same commit.
- Empty states fit their context, and counts handle one ("1 rating").
- Each event is announced once. The notification region is already live, so don't repeat its message in the `sr-only` status.

## Dead code and docs

- Removing the last caller removes the method, route, index or test that existed only for it.
- When a route, flow or limit changes, update `docs/cataloguing.md` in the same commit.
