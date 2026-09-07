import { app, session, shell, BrowserWindow } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../assets/icon.png?asset";
import { createCatalogRuntime, type CatalogRuntime } from "./catalog-runtime";
import { registerIpc } from "./ipc";
import { AppStore } from "./store";
import { windowBackgroundColor } from "./window-chrome";
import {
  normalizeAccentColor,
  normalizeThemeMode,
  windowSymbolColor,
} from "../shared/appearance";

let mainWindow: BrowserWindow | null = null;
let catalogRuntime: CatalogRuntime | null = null;
let stopping = false;

const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function createWindow(store: AppStore): void {
  const settings = store.getSettings();
  const themeMode = normalizeThemeMode(settings.themeMode);
  const accentColor = normalizeAccentColor(settings.accentColor);
  const backgroundColor = windowBackgroundColor(settings);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor,
    title: "IMDBrain",
    icon,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: backgroundColor,
      symbolColor: windowSymbolColor(accentColor, themeMode),
      height: 36,
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.imdbrain.app");
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
  catalogRuntime = createCatalogRuntime(store, () => mainWindow);
  registerIpc(store, () => mainWindow, catalogRuntime);
  catalogRuntime.start();
  createWindow(store);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(store);
  });
});

app.on("before-quit", (event) => {
  if (stopping || !catalogRuntime) return;
  event.preventDefault();
  stopping = true;
  void Promise.race([
    catalogRuntime.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
