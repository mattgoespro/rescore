# Functional review fixes — 2026-10-13

All eleven findings from [the functional review](functional-code-review-2026-10-13.md) are addressed in the working tree.

| Finding                               | Implemented behavior                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rebuild deletes saved ratings         | Titles referenced by the library survive reconciliation. Empty input is rejected; catalogues of at least 1000 titles reject input with fewer than half that many accepted titles before committing removals. Corrupt gzip errors propagate through ingestion and cancel removals. |
| Unscored Watched fails                | Absent scores are omitted from requests. Watched entries can be unscored, and status-only updates preserve an existing score and date.                                                                                                                                            |
| Wrong library timestamps              | Library update timestamps use a distinct SQL alias; catalogue updates no longer replace activity dates.                                                                                                                                                                           |
| Stale Search/For You                  | Library revisions immediately remove ineligible rows and refresh dependent results/profile data. Search reloads the previously loaded page depth without resetting selection or deliberately scrolling to the top. Superseded responses are ignored.                              |
| Service recovery stays blocked        | A healthy service after an error resumes readiness polling and hydration subscriptions and returns the desktop to ready automatically.                                                                                                                                            |
| Taste-cache race                      | Reads share one loader per generation. Invalidated loads cannot repopulate the cache or clear a newer loader. Catalogue URL/identity changes and rebuild requests invalidate taste.                                                                                               |
| Partial image cache                   | Downloads use unique temporary files, validate completion, and atomically publish the final file. Completion metadata distinguishes complete images from legacy partial files. Concurrent requests share one download; failures retry on the next request.                        |
| Ninth excluded genre fails            | The API accepts up to 30 exclusions, matching the included-genre limit and covering all available IMDb genres.                                                                                                                                                                    |
| Region setting has no effect          | Removed the unsupported per-user control and persisted field. New services use US certificates with the existing fallback behavior; existing service configuration retains its region during maintenance.                                                                         |
| Imported rating dates lost            | Valid IMDb `Date Rated` values are normalized to UTC and passed through IPC, HTTP, SQLite, DTOs, Undo, Library ordering, and recent-watch ranking. Invalid/absent dates remain unknown.                                                                                           |
| IMDb ratings API setting does nothing | Removed the control, persisted field, unused client, and obsolete default constant. Legacy settings are cleaned when loaded.                                                                                                                                                      |

## Storage and compatibility

The API adds a nullable `library_entries.rated_at` column through its existing migration system. Existing ratings and entries are retained. Earlier imports without dates keep their existing fallback activity timestamp; reimport the original CSV to recover dates it contains. No old dates are invented.

Existing image files without completion metadata are fetched again when requested, allowing previously poisoned cache entries to recover. Successful files subsequently use the validated cache. This can temporarily increase image requests after updating the API.

The rebuild size guard cancels removals after suspicious input; it does not claim to roll back title upserts already accepted in the current pass. Saved library entries remain protected independently of that guard.

## Verification

- **116 API tests and 81 desktop tests pass.** Regression cases cover retained library entries, empty/small/corrupt ingest, distinct activity/catalogue dates, imported dates, status-only updates, Undo/reopening, unscored Watched, genre exclusions, cache races, settings migration, and interrupted/concurrent image downloads.
- **22 browser checks pass** via `npm run test:ui --workspace=rescore`, including retained Search scroll/pages, draft protection, removal/Undo, keyboard navigation, contrast, reduced motion, both themes, and 1100×720 layout.
- `npm run test:library-ui --workspace=rescore` passes: watched titles leave Search and For You, requests refresh, and inspector selection remains intact.
- `npm run test:recovery --workspace=rescore` passes: the actual desktop runtime module returns to ready after simulated service failure/recovery.
- The non-elevated Windows lifecycle fixture passes after removing per-user region propagation.
- Both workspace TypeScript checks, API compilation, desktop production build, scoped ESLint error checks, and diff whitespace checks pass. Existing lint style warnings were not treated as functional defects.

All test data is isolated. These checks do not update the installed app, real catalogue, library, settings, or Windows service. Installer deployment, reboot, and cross-user acceptance remain separate verification.
