# Local catalog API

The API persists its self-hosted catalog in SQLite at `CATALOG_DB_PATH` (default:
`data/catalog.sqlite` relative to the process working directory). Migrations run
automatically when the service starts, or explicitly with `npm run migrate -w
@rescore/api`.

On first start, if the catalog has no titles, the API downloads IMDb ratings
and title basics in parallel, imports titles, then marks the catalog ready.
Credits (crew, principals, names) download and import afterwards; quitting
during that phase does not wipe titles. `GET /health` reports `ready`,
`titlesReady`, `creditsReady`, `building`, and `catalogMessage`; while the
title steps run, `catalogSetup` adds per-file download bytes, indexing
progress, an overall fraction and the current step's time left. Dumps are
reused when a HEAD check matches the stored ETag/size and the gzip header is
valid. `POST /v1/catalog/rebuild` rebuilds titles from the desktop Settings
screen without re-downloading dumps that still match the remote files.
Library entries and poster URLs for titles that still exist after the rebuild
are kept.

## Build from IMDb datasets

`npm run build:catalog` (or `npm run build:catalog -w @rescore/api`) always
rebuilds from the dumps. The API also does this on first launch when the
catalog is empty. Dumps land in `data/`:

- `title.basics.tsv.gz` — movies, TV series, and mini-series (non-adult, with ratings)
- `title.ratings.tsv.gz` — IMDb rating and vote count
- `title.crew.tsv.gz` — directors
- `title.principals.tsv.gz` + `name.basics.tsv.gz` — top billed cast

Existing library entries are preserved when the title still exists after the
rebuild. Poster URLs already stored on matching titles are restored as well.
Use `--force` to rebuild SQLite even when a catalog already exists. Dumps are
still skipped when ETag, size, and gzip checks match.

## Tooling and lifecycle entry points

Development and validation commands live in `scripts/`, beside `src/`:
`migrate.ts`, `build-catalog.ts`, `enrich-posters.ts`, and
`tmdb-throughput-smoke.ts`. Run them through the corresponding npm commands
(`migrate`, `build:catalog`, `enrich:posters`, and `smoke:tmdb`). They use the
API's source modules and configuration but are excluded from production output.

`npm run test:scripts -w @rescore/api` verifies these commands against temporary
catalogues and local IMDb/TMDb fixtures. It also verifies the clean production
build and compiled lifecycle helpers, without accessing an installed service.

Functional service entry points stay in `src/lifecycle/`: `service-data.ts`
performs catalogue transfers during maintenance, and `service-stop.ts` requests
authenticated shutdown. The build emits them under `dist/lifecycle/` while
keeping the API entry point at `dist/index.js`. `scripts/build.mjs` clears the
generated API `dist/` before compilation so obsolete tooling cannot be packaged.

## TMDb hydration

Browsing starts after IMDb titles are ready; cast and directors load behind it. Visible titles and
opened details hydrate on demand while background upkeep processes remaining
rows by IMDb vote count. Both paths share prioritized, deduplicated jobs and
provider limits. Completion is resumable: SQL `NULL` means pending, while an empty string means
TMDb completed the lookup without that value. `GET /v1/media` caches image
bytes under `data/posters/`.

TMDb keys are compiled from gitignored `src/tmdb-keys.local.ts`. A direct
launch can override them with `TMDB_API_KEYS` or `TMDB_API_KEY`. The shared
TMDb budget defaults to
`TMDB_CONCURRENCY=8` and `TMDB_REQUESTS_PER_SECOND=40`; it slows down and
retries when TMDb responds with `429` or a `Retry-After` value.

## Licensed overlay

`POST /v1/imports/catalog` accepts a provider-neutral, licensed-bundle manifest
for fields IMDb dumps do not include (posters, synopses, and similar). It
intentionally does not implement any external vendor format. The request is
validated, limited to 50,000 titles, and replaces the metadata, genres, cast,
and directors for each supplied title.

```json
{
  "version": 1,
  "titles": [{
    "id": "tt0111161",
    "title": "The Shawshank Redemption",
    "kind": "movie",
    "year": 1994,
    "runtimeMinutes": 142,
    "genres": ["Drama"],
    "directors": ["Frank Darabont"],
    "cast": ["Tim Robbins", "Morgan Freeman"]
  }]
}
```

The `201` response includes an import id; retrieve it using
`GET /v1/imports/:id`. Imports complete synchronously for now, so the returned
status will ordinarily be `completed`.

IMDb ratings remain synchronized through the existing `POST /sync` endpoint and
startup/daily job. Ratings are stored in memory for legacy `POST /ratings`
lookups and are also applied to catalog titles that are already imported.
