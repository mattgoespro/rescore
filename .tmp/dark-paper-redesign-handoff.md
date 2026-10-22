# Dark paper redesign — handoff (2026-10-22)

Status of the Rescore UI redesign done in a Claude session, for continuing in Claude Code.

## Where the work is
- All changes are written to the local repo `C:\Users\Matt\Desktop\Code\Desktop\rescore` (apps/desktop). **Nothing is committed** — review with `git status` / `git diff`.
- Design reference: Claude Design canvas "Rescore UI Overhaul" (boards DarkPaperDiscover, ForYou, Library, Catalogue).
- Delete the now-unused file `apps/desktop/src/renderer/src/components/inspector/backdrop.tsx` (could not be deleted remotely).
- New binary asset to commit: `apps/desktop/src/renderer/src/assets/rescore-mark.png`.

## What changed
- Theme ("Dark paper"): flat neutral greys, gold accent `#CEAA34`, Geist font, 4–6px radii, no shadows. Tokens still `--imd-*` (`styles/theme.css`, `tailwind.config.mts`, `styles/*.css`). Light theme included.
- Shell: single 48px top bar (`components/top-bar.tsx`) — logo, Discover / For you / Library, centred search (Ctrl K, `name="titleQuery"`), catalogue status chip with tooltip, Settings. `TITLE_BAR_HEIGHT = 48` and `windowSymbolColor(themeMode)` in `shared/appearance.ts`; main process uses them.
- Helpers in `lib/ui.ts`: `btn()` (+ `"small"` variant), `iconBtn`, `segmentedGroup/segmentedCell` (labels size the cells; even 3px inset), `chipClass`, `ratingCell`.
- Filter panel: sections, active-filter count (`lib/active-filters.ts` + test), Clear all, tri-state genre chips at natural width wrapping in rows, segmented Type control, switch toggles.
- Discover: grid view by default; age badge moved to the right of the card's star-rating row.
- For you: top pick + ranked list, ranking-mode switch, "Your taste model" aside.
- Library: rating histogram, top genres, shelf tabs with counts (still a virtualized list).
- Settings: card layout; TMDb coverage cached for the session (`lib/tmdb-health.ts`, warmed from App when the catalogue is ready) so bars don't refill or jump.
- Inspector (details panel on Discover): **reverted to the original pre-redesign code** at the user's request, with one later change: the poster spans the panel's full width, flush to the top, `h-[min(40vh,360px)]`, `object-cover object-top` (bottom cropped). Open option: let it grow to full poster height instead.

## Verification at handoff
- `npm run typecheck`, unit tests (115 pass), ESLint (2 cosmetic warnings in restored `inspector/library-status.tsx`: `tracking-[0.08em]` → `tracking-kicker`).
- `scripts/verify-ui.mjs` (29 checks) and `scripts/verify-library-refresh.mjs` pass in a sandbox; still to run locally with `npm run test:ui`, and check visually with `npm run dev` (real posters, caption buttons).

## User preferences seen
- Don't commit or push unless asked.
- Fix regressions in place; revert when asked rather than iterating further.
