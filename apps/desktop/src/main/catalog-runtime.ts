import { shouldTerminateCatalogApi } from "./catalog-reload";
import { catalogOwner, catalogUnreachableStep } from "./catalog-owner";
import { is } from "@electron-toolkit/utils";
import { app, type BrowserWindow } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_CATALOG_API_URL,
  type CatalogPhase,
  type CatalogStatus,
} from "../shared/types";
import type { BackgroundServiceStatus } from "../shared/background-service";
import { planApiLaunch } from "./api-launch";
import { BackgroundService, serviceOwnsCatalog } from "./background-service";
import {
  blockCatalogConnection,
  catalogFetch,
  effectiveCatalogUrl,
  matchesServiceHealth,
  serviceConnection,
} from "./catalog-connection";
import { createCatalogLifecycle } from "./catalog-lifecycle";
import {
  createHydrationEventParser,
  hydrationEventsUrl,
} from "./hydration-events";
import type { AppStore } from "./store";
import { sendToWindow } from "./window-lifecycle";

interface HealthPayload {
  ready?: boolean;
  building?: boolean;
  catalogPhase?: string;
  catalogMessage?: string;
  catalogError?: string | null;
  catalogDownload?: CatalogStatus["download"];
  catalogSetup?: CatalogStatus["setup"];
  titleCount?: number;
  catalogBuiltAt?: string | null;
  titlesReady?: boolean;
  creditsReady?: boolean;
  titlesUpdateAvailable?: boolean;
  creditsFailed?: boolean;
  catalogUsable?: boolean;
  tmdbHydration?: CatalogStatus["tmdbHydration"];
}
export interface CatalogRuntime {
  start(): void;
  retry(): void;
  rebuild(): CatalogStatus;
  status(): CatalogStatus;
  stop(): Promise<void>;
  repairService(): Promise<BackgroundServiceStatus>;
  serviceStatus(): BackgroundServiceStatus;
}

export function createCatalogRuntime(
  store: AppStore,
  getWindow: () => BrowserWindow | null,
  service: BackgroundService,
  onStatus?: (status: CatalogStatus) => void,
): CatalogRuntime {
  let spawned: ChildProcess | null = null;
  let childUrl = "";
  const controlToken = randomBytes(32).toString("hex");
  const url = () => catalogUrl(store);
  const childAlive = () =>
    spawned != null && spawned.exitCode == null && spawned.signalCode == null;
  const lifecycle = createCatalogLifecycle({
    serviceOwned: serviceOwnsCatalog,
    inspect: async (intent, signal) => {
      signal.throwIfAborted();
      const facts = await service.inspect(intent);
      signal.throwIfAborted();
      return facts;
    },
    maintain: (action) => service.maintain(action),
    block: () => blockCatalogConnection(true),
    probe: async (signal) => {
      const baseUrl = url();
      const health = await readHealth(baseUrl, signal);
      signal.throwIfAborted();
      const open = health != null || (await portOpen(baseUrl));
      signal.throwIfAborted();
      return {
        health: health ? statusFromHealth(health) : null,
        portOpen: open,
        childAlive: childAlive(),
      };
    },
    spawn: async () => {
      if (
        catalogUnreachableStep(catalogOwner(serviceOwnsCatalog())) === "refuse"
      )
        throw new Error("Catalogue is owned by the Windows service.");
      const baseUrl = url();
      const plan = planApiLaunch(
        {
          dev: is.dev,
          packaged: app.isPackaged,
          localUrl: isLocalUrl(baseUrl),
          appPath: app.getAppPath(),
          dirname: __dirname,
          cwd: process.cwd(),
          resourcesPath: process.resourcesPath,
          userDataDir: app.getPath("userData"),
          npmNodeExecPath: process.env.npm_node_execpath,
          platform: process.platform,
        },
        existsSync,
      );
      if (!plan.ok) throw new Error(plan.message);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: portFromUrl(baseUrl),
        RESCORE_CONTROL_TOKEN: controlToken,
        IMDB_DATA_DIR: plan.dataDir,
        CATALOG_DB_PATH: join(plan.dataDir, "catalog.sqlite"),
      };
      delete env.RESCORE_SERVICE_CONFIG;
      delete env.TMDB_API_KEYS;
      delete env.TMDB_API_KEY;
      const child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env,
        stdio:
          plan.stdio === "inherit"
            ? ["ignore", "inherit", "inherit"]
            : "ignore",
        windowsHide: plan.windowsHide,
      });
      spawned = child;
      childUrl = baseUrl;
      child.on("exit", () => {
        if (spawned === child) {
          spawned = null;
          lifecycle.childExited();
        }
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    },
    killOwned: async () => {
      const child = spawned;
      spawned = null;
      await killProcessTree(child);
    },
    stopOwned: async () => {
      const child = spawned;
      spawned = null;
      if (!shouldTerminateCatalogApi({ ownsApi: child != null }) || !child)
        return;
      try {
        await fetch(new URL("/internal/shutdown", childUrl), {
          method: "POST",
          headers: { Authorization: `Bearer ${controlToken}` },
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        });
        const deadline = Date.now() + 30000;
        while (
          child.exitCode == null &&
          child.signalCode == null &&
          Date.now() < deadline
        )
          await sleep(100);
      } catch {
        /* A failed graceful stop falls through to process-tree cleanup. */
      }
      await killProcessTree(child);
    },
    rebuild: async (signal) => {
      const response = await catalogFetch(
        new URL("/v1/catalog/rebuild", `${url()}/`),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ force: true }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        },
      );
      if (!response.ok && response.status !== 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? `Catalog rebuild failed (${response.status})`,
        );
      }
    },
    subscribeHydration: (report) => {
      const baseUrl = url();
      if (!isLocalUrl(baseUrl)) return () => {};
      const controller = new AbortController();
      void (async () => {
        while (!controller.signal.aborted) {
          try {
            const response = await catalogFetch(hydrationEventsUrl(baseUrl), {
              headers: { Accept: "text/event-stream" },
              signal: controller.signal,
            });
            if (!response.ok || !response.body)
              throw new Error("Hydration events unavailable");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parser = createHydrationEventParser();
            try {
              while (!controller.signal.aborted) {
                const chunk = await reader.read();
                if (chunk.done) break;
                for (const hydration of parser.push(
                  decoder.decode(chunk.value, { stream: true }),
                )) {
                  if (!controller.signal.aborted) report(hydration);
                }
              }
            } finally {
              reader.releaseLock();
            }
          } catch {
            /* Health observations determine liveness, independently of the stream. */
          }
          if (!controller.signal.aborted)
            await delay(1000, undefined, { signal: controller.signal }).catch(
              () => undefined,
            );
        }
      })();
      return () => controller.abort();
    },
    publish: (status) => {
      sendToWindow(getWindow(), "catalog:status", status);
      onStatus?.(status);
    },
  });
  return lifecycle;
}

function catalogUrl(store: AppStore): string {
  const raw = effectiveCatalogUrl(store.getSettings().catalogApiUrl).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_CATALOG_API_URL;
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function portFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    return parsed.protocol === "https:" ? "443" : "80";
  } catch {
    return "3847";
  }
}

function portOpen(baseUrl: string): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    host = new URL(baseUrl).hostname;
    port = Number(portFromUrl(baseUrl));
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    const socket = connect({ host, port });
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function readHealth(
  baseUrl: string,
  signal: AbortSignal,
): Promise<HealthPayload | null> {
  try {
    const response = await catalogFetch(new URL("/health", `${baseUrl}/`), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    const health = await response.json();
    const expected = serviceConnection();
    if (
      serviceOwnsCatalog() &&
      (!expected || !matchesServiceHealth(health, expected))
    )
      return null;
    return health as HealthPayload;
  } catch {
    return null;
  }
}

function statusFromHealth(health: HealthPayload): CatalogStatus {
  const titleCount = health.titleCount ?? 0;
  const builtAt = health.catalogBuiltAt ?? null;
  const error = health.catalogError ?? null;
  const message =
    health.catalogMessage?.trim() ||
    (health.building
      ? "Building catalog from IMDb datasets…"
      : health.ready
        ? `Using existing catalog (${titleCount.toLocaleString()} titles).`
        : "Starting the local catalog…");
  let phase: CatalogPhase = "starting";
  if (health.catalogPhase === "error" || error) phase = "error";
  else if (health.catalogPhase === "building" || health.building)
    phase = "building";
  else if (health.ready || health.catalogPhase === "ready") phase = "ready";
  return {
    phase,
    message,
    titleCount,
    builtAt,
    error,
    download: health.catalogDownload ?? null,
    setup: health.catalogSetup ?? null,
    titlesReady: health.titlesReady,
    creditsReady: health.creditsReady,
    titlesUpdateAvailable: health.titlesUpdateAvailable === true,
    creditsFailed: health.creditsFailed === true,
    catalogUsable: health.catalogUsable === true,
    tmdbHydration: health.tmdbHydration,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(child: ChildProcess | null): Promise<void> {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === "win32") {
    await killPid(child.pid);
    return;
  }
  if (child.exitCode == null) child.kill("SIGTERM");
  const deadline = Date.now() + 2000;
  while (child.exitCode == null && Date.now() < deadline) await sleep(100);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function killPid(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await execFileNoThrow("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  await sleep(400);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function execFileNoThrow(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        resolve(error ? "" : String(stdout ?? ""));
      },
    );
  });
}
