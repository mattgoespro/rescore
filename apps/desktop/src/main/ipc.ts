import { effectiveCatalogUrl, serviceConnection } from "./catalog-connection";
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
import { readFileSync, writeFileSync } from "fs";
import { isAppearanceOnlyPatch } from "../shared/appearance";
import {
  type DiscoverFilters,
  type ForYouResult,
  type ImportProgress,
  type MovieSummary,
  type Settings,
} from "../shared/types";
import { CatalogClient, CatalogError } from "./catalog-client";
import type { CatalogRuntime } from "./catalog-runtime";
import { parseImdbRatingsCsv } from "./csv";
import type { SearchHistoryInput } from "../shared/search-history";
import { buildProfile, describeProfile, publicProfile } from "./ranking";
import {
  createLibraryTasteWorkflow,
  type LibraryUpsert,
} from "./library-taste";
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
  ipcMain.handle("catalog:tmdbHealth", () => getClient().tmdbHealth());
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
        canLoadMore: false,
      },
      () => workflow.discover(filters),
    ),
  );
  ipcMain.handle("catalog:title", (_event, imdbId: string) =>
    withCatalog(null, () => getClient().title(imdbId)),
  );
  ipcMain.handle("catalog:people", (_event, query: unknown, role: unknown) => {
    if (
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 200 ||
      (role !== "director" && role !== "cast")
    )
      return [];
    return withCatalog([], () => getClient().searchPeople(query, role));
  });
  ipcMain.handle("catalog:fillMedia", (_event, ids: string[]) =>
    withCatalog([], () => getClient().fillMedia(ids)),
  );
  ipcMain.handle("catalog:movieMeta", (_event, movies: MovieSummary[]) =>
    withCatalog({}, () => workflow.enrich(movies)),
  );
  ipcMain.handle("library:list", () => withCatalog([], () => workflow.list()));
  ipcMain.handle("library:upsert", (_event, payload: LibraryUpsert) =>
    workflow.upsert(payload),
  );
  ipcMain.handle("library:remove", (_event, imdbId: string) =>
    workflow.remove(imdbId),
  );
  ipcMain.handle("library:clear", () => workflow.clear());
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
    withCatalog(emptyForYou(), () => workflow.forYou()),
  );
  ipcMain.handle("ranking:profile", () => workflow.profile());
}

let workflow: ReturnType<typeof createLibraryTasteWorkflow<CatalogClient>>;
function getClient(): CatalogClient {
  return workflow.client();
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
        library: await workflow.list(),
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
  return workflow.importRatings(rows, (progress) =>
    sendToWindow(getWindow(), "library:importProgress", progress),
  );
}
