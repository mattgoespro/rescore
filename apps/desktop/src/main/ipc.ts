import { effectiveCatalogUrl } from "./catalog-connection";
import {
  BackgroundService,
  serviceOwnsCatalog,
  serviceRequired,
} from "./background-service";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "fs";
import { isAppearanceOnlyPatch } from "../shared/appearance";
import {
  sortMovies,
  titleKey,
  type DiscoverFilters,
  type ForYouResult,
  type ImportProgress,
  type LibraryEntry,
  type MovieDetails,
  type MovieEnrichment,
  type MovieSummary,
  type Settings,
  type WatchStatus,
} from "../shared/types";
import { CatalogClient, CatalogError, genreId } from "./catalog-client";
import type { CatalogRuntime } from "./catalog-runtime";
import { parseImdbRatingsCsv } from "./csv";
import type { SearchHistoryInput } from "../shared/search-history";
import {
  buildProfile,
  describeProfile,
  publicProfile,
  scoreMovie,
} from "./ranking";
import type { AppStore } from "./store";
import { applyWindowChrome } from "./window-chrome";

let store: AppStore;
let getWindow: () => BrowserWindow | null;
let catalog: CatalogRuntime;

function trustedServiceSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (
    event.sender !== getWindow()?.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  try {
    const url = new URL(event.senderFrame.url);
    if (app.isPackaged)
      return (
        url.protocol === "file:" &&
        fileURLToPath(url).toLowerCase() ===
          resolve(__dirname, "../renderer/index.html").toLowerCase()
      );
    return (
      !!process.env.ELECTRON_RENDERER_URL &&
      url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    );
  } catch {
    return false;
  }
}

export function registerIpc(
  appStore: AppStore,
  windowGetter: () => BrowserWindow | null,
  catalogRuntime: CatalogRuntime,
  backgroundService: BackgroundService,
): void {
  store = appStore;
  getWindow = windowGetter;
  catalog = catalogRuntime;
  const serviceAction = (event: Electron.IpcMainInvokeEvent) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return backgroundService.ensureRunning();
  };
  ipcMain.handle("background-service:status", (event) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return backgroundService.getStatus();
  });
  ipcMain.handle("background-service:retry", (event) => serviceAction(event));
  ipcMain.handle("background-service:logs", (event) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return backgroundService.openLogs();
  });
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_event, patch: Partial<Settings>) => {
    const previousUrl = store.getSettings().catalogApiUrl;
    if (
      serviceOwnsCatalog() &&
      patch.catalogApiUrl !== undefined &&
      patch.catalogApiUrl !== previousUrl
    )
      throw new Error(
        "Packaged Windows builds require the local catalogue service.",
      );
    const next = store.setSettings(patch);
    if (next.catalogApiUrl !== previousUrl) catalog.retry();
    else if (!isAppearanceOnlyPatch(patch))
      void getClient()
        .genres()
        .catch(() => undefined);
    applyWindowChrome(getWindow(), next);
    return next;
  });
  ipcMain.handle("catalog:status", () => catalog.status());
  ipcMain.handle("catalog:tmdbHealth", () =>
    withCatalog({ total: 0, posters: 0, synopses: 0, certifications: 0 }, () =>
      getClient().tmdbHealth(),
    ),
  );
  ipcMain.handle("catalog:retry", async (event) => {
    if (serviceRequired()) {
      if (!trustedServiceSender(event))
        throw new Error("Untrusted service request");
      await backgroundService.ensureRunning();
    }
    catalog.retry();
    return catalog.status();
  });
  ipcMain.handle("catalog:rebuild", () => catalog.rebuild());
  ipcMain.handle("catalog:configured", () => getClient().configured());
  ipcMain.handle("catalog:genres", () =>
    withCatalog([], () => getClient().genres()),
  );
  ipcMain.handle("catalog:discover", (_event, filters: DiscoverFilters) =>
    withCatalog(
      {
        page: 1,
        totalPages: 0,
        totalResults: 0,
        results: [],
        nextCursor: null,
      },
      () => discover(filters),
    ),
  );
  ipcMain.handle("catalog:title", (_event, imdbId: string) =>
    withCatalog(null, () => getClient().title(imdbId)),
  );
  ipcMain.handle("catalog:fillMedia", (_event, ids: string[]) =>
    withCatalog([], () => getClient().fillMedia(ids)),
  );
  ipcMain.handle("catalog:movieMeta", (_event, movies: MovieSummary[]) =>
    withCatalog({}, () => enrichMovies(movies)),
  );
  ipcMain.handle("library:list", () =>
    withCatalog([], () => getClient().listLibrary()),
  );
  ipcMain.handle("library:upsert", (_event, payload: LibraryUpsert) =>
    upsertLibrary(payload),
  );
  ipcMain.handle("library:remove", async (_event, imdbId: string) => {
    await getClient().removeLibrary(imdbId);
    matchCache = null;
    return getClient().listLibrary();
  });
  ipcMain.handle("library:clear", async () => {
    const entries = await getClient().listLibrary();
    await Promise.all(
      entries.map((entry) => getClient().removeLibrary(entry.imdbId)),
    );
    matchCache = null;
    return [];
  });
  ipcMain.handle("library:export", () => exportLibrary());
  ipcMain.handle("library:importImdbCsv", () => importImdbCsv());
  ipcMain.handle("search-history:list", () => store.listSearchHistory());
  ipcMain.handle("search-history:save", (_event, input: SearchHistoryInput) =>
    store.saveSearchHistory(input),
  );
  ipcMain.handle("search-history:remove", (_event, id: string) =>
    store.removeSearchHistory(id),
  );
  ipcMain.handle("ranking:forYou", () =>
    withCatalog(emptyForYou(), () => forYou()),
  );
  ipcMain.handle("ranking:profile", async () => {
    const [library, genres] = await Promise.all([
      withCatalog([], () => getClient().listLibrary()),
      withCatalog([], () => getClient().genres()),
    ]);
    return publicProfile(buildProfile(library, genres));
  });
}

interface LibraryUpsert {
  movie: MovieSummary | MovieDetails;
  status: WatchStatus;
  rating?: number;
}

let catalogClient: CatalogClient | null = null;
let catalogClientUrl = "";
let matchCache: {
  library: LibraryEntry[];
  genres: { id: number; name: string }[];
} | null = null;

async function matchContext(): Promise<{
  library: LibraryEntry[];
  genres: { id: number; name: string }[];
}> {
  if (matchCache) return matchCache;
  const [library, genres] = await Promise.all([
    getClient().listLibrary(),
    getClient().genres(),
  ]);
  matchCache = { library, genres };
  return matchCache;
}

function getClient(): CatalogClient {
  const url = effectiveCatalogUrl(store.getSettings().catalogApiUrl);
  if (!catalogClient || catalogClientUrl !== url) {
    catalogClient = new CatalogClient(url);
    catalogClientUrl = url;
  }
  return catalogClient;
}

async function withCatalog<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CatalogError && error.status === 0) {
      console.warn(error.message);
      return fallback;
    }
    throw error;
  }
}

function emptyForYou(): ForYouResult {
  const profile = buildProfile([], []);
  return {
    profile: publicProfile(profile),
    insights: describeProfile(profile),
    movies: [],
  };
}

async function discover(filters: DiscoverFilters) {
  const page = await getClient().discover(filters);
  if (filters.sortBy !== "match") return page;
  const { library, genres } = await matchContext();
  const profile = buildProfile(library, genres);
  if (profile.ratedCount < 3) return page;
  const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
  return {
    ...page,
    results: sortMovies(
      page.results.map((movie) =>
        scoreMovie(movie, profile, store.getSettings().rankingMode, entries),
      ),
      "match",
    ),
  };
}

async function upsertLibrary({
  movie,
  status,
  rating,
}: LibraryUpsert): Promise<LibraryEntry[]> {
  await getClient().saveLibrary(movie as MovieSummary, status, rating);
  matchCache = null;
  return getClient().listLibrary();
}

async function forYou(): Promise<ForYouResult> {
  const payload = await getClient().forYouPage(80);
  const library = payload.library.map(
    ({ title, status, personalRating, updatedAt }) =>
      toLibraryFromDto(title, status, personalRating ?? undefined, updatedAt),
  );
  const genres = payload.facets.genres.map((genre) => ({
    id: genreId(genre.value),
    name: genre.value,
  }));
  const candidates = payload.candidates.map(toSummaryFromDto);
  const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
  const profile = buildProfile(library, genres);
  const movies = sortMovies(
    candidates.map((movie) =>
      scoreMovie(movie, profile, store.getSettings().rankingMode, entries),
    ),
    "match",
  ).slice(0, 40);
  return {
    profile: publicProfile(profile),
    insights: describeProfile(profile),
    movies,
  };
}

function toSummaryFromDto(title: {
  id: string;
  title: string;
  originalTitle: string | null;
  kind: string;
  year: number | null;
  runtimeMinutes: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  certification: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  genres: string[];
  directors: string[];
  cast: string[];
  languages?: string[];
}): MovieSummary {
  const kind = title.kind.toLowerCase();
  const titleKind = kind.includes("mini")
    ? "miniseries"
    : kind.includes("tv") || kind.includes("series")
      ? "tv"
      : "movie";
  return {
    imdbId: title.id.toLowerCase(),
    mediaType: titleKind === "movie" ? "movie" : "tv",
    titleKind,
    title: title.title,
    originalTitle: title.originalTitle ?? undefined,
    overview: title.synopsis ?? "",
    posterPath: title.posterUrl,
    backdropPath: null,
    releaseDate: title.year ? `${title.year}-01-01` : "",
    year: title.year ?? undefined,
    genreIds: title.genres.map(genreId),
    originalLanguage: title.languages?.[0] ?? "",
    languages: title.languages ?? [],
    popularity: 0,
    voteAverage: title.imdbRating ?? 0,
    voteCount: title.imdbVotes ?? 0,
    adult: false,
    certification: title.certification || undefined,
    runtime: title.runtimeMinutes ?? undefined,
    directorIds: title.directors.map(genreId),
    directorNames: title.directors,
    castIds: title.cast.map(genreId),
    castNames: title.cast,
  };
}

function toLibraryFromDto(
  title: Parameters<typeof toSummaryFromDto>[0],
  status: WatchStatus,
  rating: number | undefined,
  updatedAt: string,
): LibraryEntry {
  const movie = toSummaryFromDto(title);
  return {
    ...movie,
    status,
    rating,
    updatedAt,
    directorIds: movie.directorIds ?? [],
    directorNames: movie.directorNames ?? [],
    castIds: movie.castIds ?? [],
    castNames: movie.castNames ?? [],
  };
}

async function enrichMovies(
  movies: MovieSummary[],
): Promise<Record<string, MovieEnrichment>> {
  const [library, genres] = await Promise.all([
    getClient().listLibrary(),
    getClient().genres(),
  ]);
  const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
  const profile = buildProfile(library, genres);
  return Object.fromEntries(
    movies.map((movie) => {
      const ranked = scoreMovie(
        movie,
        profile,
        store.getSettings().rankingMode,
        entries,
      );
      return [
        titleKey(movie),
        { match: ranked.match, reasons: ranked.reasons },
      ];
    }),
  );
}

async function exportLibrary(): Promise<{ ok: boolean; path?: string }> {
  const options = {
    title: "Export Rescore library",
    defaultPath: "rescore-library.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  };
  const window = getWindow();
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { ok: false };
  writeFileSync(
    result.filePath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        library: await getClient().listLibrary(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, path: result.filePath };
}

async function importImdbCsv(): Promise<ImportProgress> {
  const options = {
    title: "Import IMDb ratings.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
    properties: ["openFile"] as Array<"openFile">,
  };
  const window = getWindow();
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const empty: ImportProgress = {
    current: 0,
    total: 0,
    title: "",
    imported: 0,
    skipped: 0,
    errors: 0,
    done: true,
  };
  if (picked.canceled || !picked.filePaths[0]) return empty;
  const rows = parseImdbRatingsCsv(readFileSync(picked.filePaths[0], "utf8"));
  const progress = { ...empty, total: rows.length, done: false };
  for (const [index, row] of rows.entries()) {
    progress.current = index + 1;
    progress.title = row.title;
    getWindow()?.webContents.send("library:importProgress", progress);
    try {
      const movie = await getClient().findByImdb(row.imdbId);
      if (!movie) progress.skipped++;
      else {
        await getClient().saveLibrary(movie, "watched", row.rating);
        progress.imported++;
      }
    } catch {
      progress.errors++;
    }
  }
  progress.done = true;
  progress.title = "Import complete";
  getWindow()?.webContents.send("library:importProgress", progress);
  return progress;
}
