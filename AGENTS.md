# Rescore

Windows desktop app that searches a local IMDb-linked catalogue and ranks titles from the user's ratings. Two workspaces: `@rescore/api` in `apps/api` (Express and SQLite) and `rescore` in `apps/desktop` (Electron).

## Rename

The product, npm packages, Windows service (`RescoreCatalogue`, display name Rescore API), and user-data folder (`%APPDATA%\Rescore`) are Rescore. New code, paths, and user-facing strings use Rescore. Theme tokens stay `--imd-*`.

`README.md`, `apps/api/README.md`, and `docs/cataloguing.md` still say IMDBrain. Identifiers stay `catalog` (`catalog.sqlite`, `CatalogDatabase`); the service docs say catalogue in prose.

Names and browsing readiness follow the code. Browsing starts once IMDb titles are ready. Cast, directors, and TMDb hydration continue in the background.

## Boundary

The API is the only process that downloads IMDb dumps or calls TMDb. TMDb keys stay in gitignored `apps/api/src/tmdb-keys.local.ts`.

Catalogue search, ingest, schema, and HTTP live in the API. Taste ranking runs in the desktop main process after that query (`apps/desktop/src/main/ranking.ts`).

The renderer reaches the catalogue through `window.api`. The main process is the only desktop side that calls the catalogue HTTP API. Types used by main, preload, and renderer live in `apps/desktop/src/shared`.

Library rows live in the catalogue database. Settings and search history live in the Electron store (`rescore.json`). Library methods still on `AppStore` are leftover.

A packaged build uses the one Windows catalogue service. A localhost development session may spawn the API from `apps/desktop/src/main/catalog-runtime.ts`.

API modules are ESM and import with `.js` specifiers. Desktop modules do not. Tests are `node:test`, colocated as `*.test.ts`, and run with the workspace `test` script.

## Reach

- Service start, browsing during TMDb hydration, and recovery: `docs/background-service.md`
- Administrative service commands, storage, and maintainer verification: `docs/background-service-maintenance.md`
- How to run the app and build the catalogue: `README.md` and `apps/api/README.md`
- A finished change record under `docs/superpowers/`: open it when the task names that change
