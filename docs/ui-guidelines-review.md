# UI guidelines fixes — 2026-10-12

The subsequent [functional fixes](functional-fixes-2026-10-13.md) removed the unsupported Region and IMDb ratings API controls. Settings draft/validation checks now exercise the catalogue URL and ranking mode; the current UI suite has 22 checks.

The full UI review is implemented without changing catalogue or ranking behavior.

| Review finding                                         | Change                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Appearance saves discarded ranking drafts              | Synchronize each settings field independently; protect unsaved edits during navigation and closing.                             |
| Oversized inspector at the minimum window size         | Compact poster at widths below 1181px; show rating and library actions before secondary details.                                |
| Unreadable foreground on gold controls                 | Choose contrasting text for every accent; adjust accent text on canvas, panel, and selection backgrounds.                       |
| Library removal was immediate and irreversible         | Shared Undo restores the last removed title's rating and watch status; failed removal retains the entry.                        |
| Missing announcements for async changes                | Live status, alert, and progress semantics for results, loading, settings, library writes, and import.                          |
| Theme controls lacked radio keyboard behavior          | Labelled fieldsets and radio groups with arrows, Home, End, and one tab stop.                                                   |
| History popover had incomplete menu semantics          | Nonmodal dialog containing ordinary buttons; initial focus, Escape, boundary Tab behavior, and focus restoration.               |
| Reduced motion was ignored                             | Disable animations and transitions when reduced motion is requested.                                                            |
| Long result lists mounted every loaded title           | Measured virtualization in Discover list/grid, Library, and For You; keep adjacent focused rows mounted.                        |
| Faint text and unfilled rating cells had poor contrast | Stronger faint tokens, theme-aware cell backgrounds, and readable accent text.                                                  |
| Missing hover feedback                                 | Visible feedback on grid cards, selected controls, chips, and ratings.                                                          |
| Settings validation and save feedback were incomplete  | Inline region/URL errors, focus the first invalid input, prevent duplicate saves, preserve failed drafts, and announce success. |
| Missing navigation landmarks and heading hierarchy     | Skip link, focusable main content, one primary view heading, and current-page navigation.                                       |
| Images lacked loading hints and dimensions             | Explicit poster/profile dimensions, lazy secondary images, prioritized hero image, and profile fallback on failure.             |

## Verification

- `npm run test --workspace=rescore`: 75 tests pass, including region/URL validation and accent contrast across 4096 custom colors in both themes.
- `npm run build --workspace=rescore`: TypeScript and production build pass.
- Scoped ESLint: no errors; existing style warnings remain.
- `npm run test:ui --workspace=rescore`: 20 browser checks pass using isolated IPC fixtures, 1000 sample titles, and Chrome. Includes bounded DOM size, infinite paging, keyboard focus, removal/Undo, draft preservation, validation/save failures, live semantics, reduced motion, and both themes at 1440×920 and 1100×720. The script writes screenshots and a JSON report to a temporary directory, or a supplied output directory.

Browser checks do not modify the real library, settings, or service. The native Electron close confirmation is implemented but has not been exercised in the installed app. Undo restores library content through the existing write API, so its update timestamp reflects restoration.
