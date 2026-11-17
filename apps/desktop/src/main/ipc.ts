import {
  effectiveCatalogUrl,
  serviceConnection,
  whenCatalogConnectionOpen,
} from "./catalog-connection";
import { sendToWindow } from "./window-lifecycle";
import { catalogOwner, catalogUrlChangeAllowed } from "./catalog-owner";
import {
  BackgroundService,
  serviceOwnsCatalog,
  serviceRequired,
} from "./background-service";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile, writeFile } from "fs/promises";
import { isAppearanceOnlyPatch } from "../shared/appearance";
import {
  type DiscoverFilters,
  type ImportProgress,
  type MovieSummary,
  type Settings,
} from "../shared/types";
import { CatalogClient } from "./catalog-client";
import type { CatalogRuntime } from "./catalog-runtime";
import { parseImdbRatingsCsv } from "./csv";
import {
  clearImdbWatchedSession,
  scrapeImdbCheckins,
} from "./imdb-watched-window";
import type { SearchHistoryInput } from "../shared/search-history";
import {
  createLibraryTasteWorkflow,
  type LibraryUpsert,
} from "./library-taste";
import type { AppStore } from "./store";
import { watchCreditsArrival } from "./credits-arrival";
import { applyWindowChrome } from "./window-chrome";
import { createCatalogGate } from "./catalog-gate";
import type { CatalogStatus } from "../shared/catalog-status";

let store: AppStore;
let getWindow: () => BrowserWindow | null;
let catalog: CatalogRuntime;

const gate = createCatalogGate();
const noteCreditsArrival = watchCreditsArrival(() => workflow?.invalidate());

/**
 * Catalogue status from the runtime: opens the gate catalogue calls wait on,
 * and reloads taste once cast and directors arrive.
 */
export function noteCatalogStatus(status: CatalogStatus): void {
  gate.note(status);
  noteCreditsArrival(status);
}

/**
 * Runs a catalogue call once the catalogue is usable and no catalogue data is
 * being transferred: maintenance holds a call rather than failing it.
 */
async function whenReady<T>(run: () => Promise<T>): Promise<T> {
  await gate.whenUsable();
  await whenCatalogConnectionOpen();
  return run();
}

function trustedServiceSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (
    event.sender !== getWindow()?.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  try {
    const url = new URL(event.senderFrame.url);
    // Only `electron-vite dev` serves the renderer; a packaged app and
    // `npm start` (electron-vite preview) load the built file.
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
      return url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
    return (
      url.protocol === "file:" &&
      fileURLToPath(url).toLowerCase() ===
        resolve(__dirname, "../renderer/index.html").toLowerCase()
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
  gate.note(catalog.status());
  workflow = createLibraryTasteWorkflow({
    connection: () => {
      const url = effectiveCatalogUrl(store.getSettings().catalogApiUrl);
      return {
        url,
        identity: `${url}|${serviceConnection()?.catalogId ?? ""}`,
      };
    },
    createClient: (url) => new CatalogClient(url),
    rankingMode: () => store.getSettings().rankingMode,
  });
  const serviceAction = (event: Electron.IpcMainInvokeEvent) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return catalog.repairService();
  };
  ipcMain.handle("background-service:status", (event) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return catalog.serviceStatus();
  });
  ipcMain.handle("background-service:retry", (event) => serviceAction(event));
  ipcMain.handle("background-service:logs", (event) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    return backgroundService.openLogs();
  });
  ipcMain.handle("service-log:read", (event, cursor: string | null) => {
    if (!trustedServiceSender(event))
      throw new Error("Untrusted service request");
    const from = typeof cursor === "string" ? cursor : null;
    return serviceOwnsCatalog()
      ? backgroundService.readLog(from)
      : catalog.readSessionLog(from);
  });
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", (_event, patch: Partial<Settings>) => {
    const previousUrl = store.getSettings().catalogApiUrl;
    if (
      !catalogUrlChangeAllowed(catalogOwner(serviceOwnsCatalog())) &&
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
    whenReady(() => getClient().tmdbHealth()),
  );
  ipcMain.handle("catalog:retry", async (event) => {
    if (serviceRequired()) {
      if (!trustedServiceSender(event))
        throw new Error("Untrusted service request");
      await catalog.repairService();
    } else catalog.retry();
    return catalog.status();
  });
  ipcMain.handle("catalog:rebuild", () => {
    workflow.invalidate();
    return catalog.rebuild();
  });
  ipcMain.handle("catalog:configured", () => getClient().configured());
  // Every catalogue call waits for a usable catalogue, and a failure reaches
  // the renderer as an error: with the catalogue up, one is a bug.
  ipcMain.handle("catalog:genres", () => whenReady(() => getClient().genres()));
  ipcMain.handle("catalog:discover", (_event, filters: DiscoverFilters) =>
    whenReady(() => workflow.discover(filters)),
  );
  ipcMain.handle("catalog:title", (_event, imdbId: string) =>
    whenReady(() => getClient().title(imdbId)),
  );
  ipcMain.handle("catalog:fillMedia", (_event, ids: string[]) =>
    whenReady(() => getClient().fillMedia(ids)),
  );
  ipcMain.handle("catalog:movieMeta", (_event, movies: MovieSummary[]) =>
    whenReady(() => workflow.enrich(movies)),
  );
  ipcMain.handle("library:list", () => whenReady(() => workflow.list()));
  ipcMain.handle("library:upsert", (_event, payload: LibraryUpsert) =>
    whenReady(() => workflow.upsert(payload)),
  );
  ipcMain.handle("library:remove", (_event, imdbId: string) =>
    whenReady(() => workflow.remove(imdbId)),
  );
  ipcMain.handle("library:clear", () => whenReady(() => workflow.clear()));
  ipcMain.handle("library:export", () => exportLibrary());
  ipcMain.handle("library:importImdbCsv", () => importImdbCsv());
  ipcMain.handle("imdb:authStatus", () => store.imdbAuthStatus());
  ipcMain.handle(
    "imdb:setCredentials",
    (_event, payload: { email?: string; password?: string }) => {
      const previous = store.imdbAuthStatus().email;
      const status = store.setImdbCredentials(
        payload?.email ?? "",
        payload?.password ?? "",
      );
      if (status.email !== previous) clearImdbWatchedSession();
      return status;
    },
  );
  ipcMain.handle("imdb:importWatched", () => importImdbWatched());
  ipcMain.handle("search-history:list", () => store.listSearchHistory());
  ipcMain.handle("search-history:save", (_event, input: SearchHistoryInput) =>
    store.saveSearchHistory(input),
  );
  ipcMain.handle("search-history:remove", (_event, id: string) =>
    store.removeSearchHistory(id),
  );
  ipcMain.handle("ranking:forYou", () => whenReady(() => workflow.forYou()));
  ipcMain.handle("ranking:profile", () => whenReady(() => workflow.profile()));
}

let workflow: ReturnType<typeof createLibraryTasteWorkflow<CatalogClient>>;
function getClient(): CatalogClient {
  return workflow.client();
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
  await writeFile(
    result.filePath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        library: await whenReady(() => workflow.list()),
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, path: result.filePath };
}

/** Progress updates per second at most; the last one always goes out. */
const IMPORT_PROGRESS_INTERVAL_MS = 100;
let importing: Promise<ImportProgress> | null = null;

/**
 * Settings forgets its busy state when the user leaves the page, so a second
 * Import joins the one already running instead of starting another.
 */
function importImdbCsv(): Promise<ImportProgress> {
  importing ??= pickAndImportCsv().finally(() => {
    importing = null;
  });
  return importing;
}

function importImdbWatched(): Promise<ImportProgress> {
  importing ??= scrapeAndImportWatched().finally(() => {
    importing = null;
  });
  return importing;
}

async function scrapeAndImportWatched(): Promise<ImportProgress> {
  const credentials = store.getImdbCredentials();
  if (!credentials) throw new Error("Save your IMDb email and password first.");
  sendToWindow(getWindow(), "library:importProgress", {
    current: 0,
    total: 0,
    title: "Reading Your Check-ins on IMDb",
    imported: 0,
    skipped: 0,
    errors: 0,
    done: false,
  } satisfies ImportProgress);
  const ids = await scrapeImdbCheckins(credentials, getWindow());
  let sentAt = 0;
  await whenReady(async () => undefined);
  return workflow.importWatched(ids, (progress) => {
    const now = Date.now();
    if (!progress.done && now - sentAt < IMPORT_PROGRESS_INTERVAL_MS) return;
    sentAt = now;
    sendToWindow(getWindow(), "library:importProgress", progress);
  });
}

async function pickAndImportCsv(): Promise<ImportProgress> {
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
  const rows = parseImdbRatingsCsv(await readFile(picked.filePaths[0], "utf8"));
  // A large export is thousands of rows; one message each redraws Settings
  // thousands of times.
  let sentAt = 0;
  await whenReady(async () => undefined);
  return workflow.importRatings(rows, (progress) => {
    const now = Date.now();
    if (!progress.done && now - sentAt < IMPORT_PROGRESS_INTERVAL_MS) return;
    sentAt = now;
    sendToWindow(getWindow(), "library:importProgress", progress);
  });
}
