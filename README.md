# IMDBrain

Windows desktop app for searching a self-hosted IMDb-linked catalog and ranking titles based on what you rate, watch, skip, and binge.

IMDBrain serves catalog search, title details, and current IMDb ratings through its local Express API. Import a licensed metadata bundle into the API’s SQLite database; the desktop app makes no TMDB requests.

The API refreshes **current IMDb ratings and vote counts** from IMDb’s official daily [non-commercial datasets](https://developer.imdb.com/non-commercial-datasets/). On first launch the catalog API builds movies, TV series, and mini-series (plus directors, top billed cast, genres, year, runtime, and ratings) into SQLite and reuses that catalog afterwards. A licensed metadata bundle can still overlay posters and synopses later.

## Features

- **Advanced search** — title or `tt` IMDb ID, genres, year window, rating and vote floors, runtime, hide watched/watchlist
- **Best match sort** — re-ranks search results against your taste model once you have rated enough titles; otherwise sorts by votes
- **Live IMDb ratings** — the catalog API merges the daily IMDb ratings dump before it returns a page
- **Ranked for you** — recommendations seeded from highly rated movies, then scored with genre affinity, directors, cast, era, runtime habits, and recent watch streaks
- **Watch patterns** — local library of watched / watchlist / skipped titles with ratings
- **IMDb import** — load IMDb’s ratings export to train the ranker immediately
- **Ranking modes** — balanced, more of the same, or surprise me

## Run on Windows

1. Install Node.js 20+.
2. From this folder:

```bash
npm install
npm run dev
```

That starts the Electron app, which starts the catalog API (`http://127.0.0.1:3847`) if it is not already running. The first launch downloads IMDb ratings and title basics, then opens search as soon as titles are in SQLite (typically minutes). Credits (cast/directors) and TMDB poster URLs continue in the background. Later launches reuse the existing SQLite catalog. To rebuild later, use **Settings → Rebuild catalog**, or:

```bash
npm run build:catalog -- --force
```

Optional licensed overlays are documented in [`apps/api/README.md`](apps/api/README.md).

3. In **Settings**, confirm the catalog API URL (default `http://127.0.0.1:3847`).
4. Rate a few movies you already know (or import `ratings.csv` from IMDb).
5. Open **Ranked for you**.

Individual processes:

```bash
npm run dev:api
npm run dev:desktop
```

### Windows installer

```bash
npm run build:win
```

The NSIS setup lands in `apps/desktop/dist/`. The packaged app does not bundle the catalog API; run `npm run dev:api` (or `npm start -w @imdbrain/api`) alongside it. The first time that API starts with an empty catalog, it builds titles from IMDb dumps, then hydrates credits and posters in the background.

## Ranking model

Each candidate title gets a 1–99 match score from:

| Signal | What it uses |
| --- | --- |
| Genre taste | Your ratings vs your personal average, confidence-weighted |
| Directors / cast | People who show up in films you score highly |
| Era | Decade affinity from watch history |
| Quality | Bayesian public rating (vote count matters; IMDb when the API is up) |
| Runtime | How close the film is to the lengths you actually finish |
| Watch pattern | Recent genre streaks, plus skipped-genre penalties |

The ranker scores titles from the local catalog and explains why a title scored well.

## Data

Settings stay on this PC in Electron’s user data folder (`imdbrain.json`). Catalog metadata and library state live in the API SQLite database; the API keeps `title.ratings.tsv.gz` and `catalog.sqlite` under `apps/api/data/` by default (or Electron’s user data folder when the desktop app starts the API itself) and serves localhost clients only.
