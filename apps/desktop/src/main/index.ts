import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, dialog, protocol, session, shell } from "electron";
import { BackgroundService } from "./background-service";
import { catalogFetch, effectiveCatalogUrl } from "./catalog-connection";
import { join } from "path";
import icon from "../../assets/icon.png?asset";
import {
  TITLE_BAR_HEIGHT,
  normalizeThemeMode,
  windowSymbolColor,
} from "../shared/appearance";
import { createCatalogRuntime, type CatalogRuntime } from "./catalog-runtime";
import { registerIpc } from "./ipc";
import { AppStore } from "./store";
import { windowBackgroundColor } from "./window-chrome";

let mainWindow: BrowserWindow | null = null;
let catalogRuntime: CatalogRuntime | null = null;
let stopping = false;
let quitRequested = false;
let backgroundService: BackgroundService | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rescore-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  if (stopping || mainWindow?.isDestroyed()) return;
  mainWindow?.show();
  mainWindow?.focus();
});

const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function createWindow(store: AppStore): void {
  const settings = store.getSettings();
  const themeMode = normalizeThemeMode(settings.themeMode);
  const backgroundColor = windowBackgroundColor(settings);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor,
    title: "Rescore",
    icon,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: backgroundColor,
      symbolColor: windowSymbolColor(themeMode),
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("will-prevent-unload", (event) => {
    if (!mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["Keep Editing", "Discard Changes"],
      defaultId: 0,
      cancelId: 0,
      message: "Discard your unsaved settings?",
      detail:
        "Your latest settings have not been saved. Keep editing to save them before closing.",
    });
    if (choice === 1) event.preventDefault();
    else quitRequested = false;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  if (!ownsInstance || stopping) return;
  electronApp.setAppUserModelId("com.rescore.app");
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if (/tmdb\.org|themoviedb\.org/i.test(details.url)) {
      requestHeaders["User-Agent"] = IMAGE_USER_AGENT;
    }
    callback({ requestHeaders });
  });
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const store = new AppStore();
  protocol.handle("rescore-media", async (request) => {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      url.hostname !== "catalog" ||
      url.pathname !== "/v1/media" ||
      !url.searchParams.has("src")
    )
      return new Response(null, { status: 400 });
    const target = new URL(
      "/v1/media",
      effectiveCatalogUrl(store.getSettings().catalogApiUrl),
    );
    target.searchParams.set("src", url.searchParams.get("src")!);
    try {
      return await catalogFetch(target, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  });
  backgroundService = new BackgroundService();
  catalogRuntime = createCatalogRuntime(
    store,
    () => mainWindow,
    backgroundService,
  );
  registerIpc(store, () => mainWindow, catalogRuntime, backgroundService);
  createWindow(store);
  catalogRuntime.start();

  app.on("activate", () => {
    if (!stopping && BrowserWindow.getAllWindows().length === 0)
      createWindow(store);
  });
});

app.on("before-quit", (event) => {
  if (stopping) return;
  // Let the renderer protect drafts before shutting down its catalogue runtime.
  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    quitRequested = true;
    mainWindow.close();
    return;
  }
  if (!catalogRuntime) return;
  event.preventDefault();
  stopping = true;
  void Promise.race([
    catalogRuntime.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, 32_000)),
  ]).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (quitRequested || process.platform !== "darwin") app.quit();
});
