# Local catalog API

The API persists its self-hosted catalog in SQLite at `CATALOG_DB_PATH` (default:
`data/catalog.sqlite` relative to the process working directory). Migrations run
automatically when the service starts, or explicitly with `npm run migrate -w
@imdbrain/api`.

On first start, if the catalog has no titles, the API downloads IMDb ratings
and title basics in parallel, imports titles, then marks the catalog ready.
Credits (crew, principals, names) download and import afterwards; quitting
during that phase does not wipe titles. `GET /health` reports `ready`,
`titlesReady`, `creditsReady`, `building`, and `catalogMessage`. Dumps are
reused when a HEAD check matches the stored ETag/size and the gzip header is
valid. `POST /v1/catalog/rebuild` rebuilds titles from the desktop Settings
screen without re-downloading dumps that still match the remote files.
Library entries and poster URLs for titles that still exist after the rebuild
are kept.

## Build from IMDb datasets

`npm run build:catalog` (or `npm run build:catalog -w @imdbrain/api`) always
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

## TMDB posters

Interactive hydration blocks on TMDb. `GET /v1/titles/:id` and
`POST /v1/catalog/fill` await a lookup when `poster_url`, `synopsis`, or
`certification` is still NULL, then return the title. A completed miss is
stored as `''` and those paths do not request it again. A failed lookup leaves
the column NULL and returns `error`: `TMDb details could not be loaded. Try
again.` The title payload is still returned, so the failure can be retried and
does not block the rest of the response. Discover skips certification ids that
already came back as `''`, shows that error, and will try NULL rows again.

Poster URLs use `TMDB_IMAGE_BASE` (default `https://image.tmdb.org/t/p/w342`).
`POST /v1/catalog/enrich-posters` returns 202 and only queues explicit ids
whose poster or synopsis is still NULL. It does not walk the rest of the
catalogue, and the API does not start a poster sweep when the catalog becomes
ready. `npm run enrich:posters` uses that same id-scoped lookup.
`GET /v1/media` caches image bytes under `data/posters/`.

Set `TMDB_API_KEY`, add a key in desktop Settings, or keep it in the desktop
settings file. Optional `TMDB_CONCURRENCY` (default 2) and
`TMDB_POSTER_GAP_MS` (default 300) pace lookups.

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
