import { is } from "@electron-toolkit/utils";
import { app, type BrowserWindow } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import {
  DEFAULT_CATALOG_API_URL,
  type CatalogPhase,
  type CatalogStatus,
} from "../shared/types";
import { planApiLaunch } from "./api-launch";
import { shouldRestartHungChild, shouldSpawnReplacement } from "./api-watch";
import { serviceOwnsCatalog } from "./background-service";
import {
  catalogFetch,
  effectiveCatalogUrl,
  matchesServiceHealth,
  serviceConnection,
} from "./catalog-connection";
import { shouldFinishCatalogPoll } from "./catalog-poll";
import { shouldTerminateCatalogApi } from "./catalog-reload";
import {
  createHydrationEventParser,
  hydrationEventsUrl,
} from "./hydration-events";
import type { AppStore } from "./store";

const START_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

interface HealthPayload {
  ready?: boolean;
  building?: boolean;
  catalogPhase?: string;
  catalogMessage?: string;
  catalogError?: string | null;
  catalogDownload?: CatalogStatus["download"];
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
}

export function createCatalogRuntime(
  store: AppStore,
  getWindow: () => BrowserWindow | null,
): CatalogRuntime {
  let current: CatalogStatus = {
    phase: "starting",
    message: "Starting the local catalog…",
    titleCount: 0,
    builtAt: null,
    error: null,
    download: null,
    titlesUpdateAvailable: false,
    creditsFailed: false,
    catalogUsable: false,
  };
  let generation = 0;
  let spawned: ChildProcess | null = null;
  let quitting = false;
  const controlToken = randomBytes(32).toString("hex");
  let restartAttempts = 0;
  let recovering = false;
  let hydrationEventsAbort: AbortController | null = null;

  const publish = (next: CatalogStatus): void => {
    current = next;
    getWindow()?.webContents.send("catalog:status", next);
  };

  const run = (gen: number): void => {
    void bootstrap(gen);
  };

  const start = (): void => {
    quitting = false;
    stopHydrationEvents();
    generation += 1;
    restartAttempts = 0;
    run(generation);
  };

  async function stop(): Promise<void> {
    quitting = true;
    generation += 1;
    stopHydrationEvents();
    const child = spawned;
    spawned = null;
    if (shouldTerminateCatalogApi({ ownsApi: child != null })) {
      try {
        await fetch(new URL("/internal/shutdown", catalogUrl(store)), {
          method: "POST",
          headers: { Authorization: `Bearer ${controlToken}` },
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        });
        const deadline = Date.now() + 30_000;
        while (
          child?.exitCode == null &&
          child?.signalCode == null &&
          Date.now() < deadline
        )
          await sleep(100);
      } catch {
        /* Process may already have exited. */
      }
      await killProcessTree(child);
    }
  }

  async function bootstrap(gen: number): Promise<void> {
    publish({
      phase: "starting",
      message: "Starting the local catalog…",
      titleCount: 0,
      builtAt: null,
      error: null,
      download: null,
      titlesUpdateAvailable: false,
      creditsFailed: false,
      catalogUsable: false,
    });

    const baseUrl = catalogUrl(store);
    try {
      const reachable = await canReach(baseUrl);
      if (generation !== gen || quitting) return;
      if (!reachable) {
        if (serviceOwnsCatalog()) {
          publish({
            ...current,
            phase: "error",
            error:
              "Catalogue service unavailable. Open Settings for details and Retry.",
            message: "The required catalogue service is unavailable.",
          });
          return;
        }
        if (!spawned || spawned.exitCode != null) {
          await killProcessTree(spawned);
          if (generation !== gen || quitting) return;
          spawned = null;
          const started = spawnApi(baseUrl);
          if (!started.ok) {
            publish({
              phase: "error",
              message: started.message,
              titleCount: 0,
              builtAt: null,
              error: started.message,
              download: null,
              titlesUpdateAvailable: false,
              creditsFailed: false,
              catalogUsable: false,
            });
            return;
          }
          spawned = started.child;
        }
        publish({
          phase: "starting",
          message: "Waiting for the catalog API…",
          titleCount: 0,
          builtAt: null,
          error: null,
          download: null,
          titlesUpdateAvailable: false,
          creditsFailed: false,
          catalogUsable: false,
        });
      }

      const reached = await waitForReachable(baseUrl, gen);
      if (generation !== gen) return;
      if (!reached) {
        publish({
          phase: "error",
          message: unreachableMessage(),
          titleCount: 0,
          builtAt: null,
          error: "Catalog API did not become reachable.",
          download: null,
          titlesUpdateAvailable: false,
          creditsFailed: false,
          catalogUsable: false,
        });
        return;
      }

      startHydrationEvents(baseUrl, gen);
      await pollUntilSettled(baseUrl, gen);
      if (generation === gen && !quitting) void watchApi(baseUrl, gen);
    } catch (error) {
      if (generation !== gen || quitting) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message && !message.includes("unreachable")) {
        console.warn("[catalog]", message);
      }
      await recoverApi(baseUrl, gen);
      if (generation === gen && !quitting) void watchApi(baseUrl, gen);
    }
  }

  async function waitForReachable(
    baseUrl: string,
    gen: number,
  ): Promise<boolean> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline && generation === gen) {
      if (await canReach(baseUrl)) return true;
      await sleep(POLL_MS);
    }
    return generation === gen ? canReach(baseUrl) : false;
  }

  async function pollUntilSettled(baseUrl: string, gen: number): Promise<void> {
    let missed = 0;
    while (generation === gen) {
      const health = await readHealth(baseUrl);
      if (generation !== gen) return;
      if (!health) {
        missed += 1;
        const childAlive = spawned != null && spawned.exitCode == null;
        if (!childAlive && (await portOpen(baseUrl))) {
          missed = 0;
          await sleep(POLL_MS);
          continue;
        }
        if (
          shouldSpawnReplacement({ childAlive, portOpen: false }) &&
          missed >= 8
        ) {
          throw new Error("Catalog API became unreachable.");
        }
        publish({
          phase: "starting",
          message: "Waiting for the catalog API…",
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: null,
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
          catalogUsable: current.catalogUsable,
        });
        await sleep(POLL_MS);
        continue;
      }
      missed = 0;
      restartAttempts = 0;
      const next = statusFromHealth(health);
      publish(next);
      if (
        shouldFinishCatalogPoll({
          phase: next.phase,
          catalogUsable: next.catalogUsable,
        })
      ) {
        return;
      }
      await sleep(next.download ? 200 : POLL_MS);
    }
  }

  function startHydrationEvents(baseUrl: string, gen: number): void {
    if (!isLocalUrl(baseUrl)) return;
    stopHydrationEvents();
    const controller = new AbortController();
    hydrationEventsAbort = controller;
    void consumeHydrationEvents(baseUrl, gen, controller);
  }

  function stopHydrationEvents(): void {
    hydrationEventsAbort?.abort();
    hydrationEventsAbort = null;
  }

  async function consumeHydrationEvents(
    baseUrl: string,
    gen: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      while (generation === gen && !quitting && !controller.signal.aborted) {
        try {
          const response = await catalogFetch(hydrationEventsUrl(baseUrl), {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(
              `Hydration events unavailable (${response.status})`,
            );
          }
          const parser = createHydrationEventParser();
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          try {
            while (
              generation === gen &&
              !quitting &&
              !controller.signal.aborted
            ) {
              const chunk = await reader.read();
              if (chunk.done) break;
              for (const hydration of parser.push(
                decoder.decode(chunk.value, { stream: true }),
              )) {
                if (generation !== gen || quitting) return;
                publish({ ...current, tmdbHydration: hydration });
              }
            }
          } finally {
            reader.releaseLock();
          }
        } catch {
          // Health polling remains authoritative for API liveness and recovery.
        }
        if (generation === gen && !quitting && !controller.signal.aborted) {
          await sleep(1_000);
        }
      }
    } finally {
      if (hydrationEventsAbort === controller) hydrationEventsAbort = null;
    }
  }

  async function watchApi(baseUrl: string, gen: number): Promise<void> {
    let misses = 0;
    while (generation === gen && !quitting) {
      await sleep(3000);
      if (generation !== gen || quitting) return;
      if (await canReach(baseUrl)) {
        misses = 0;
        restartAttempts = 0;
        continue;
      }
      misses += 1;
      const childAlive = spawned != null && spawned.exitCode == null;
      if (
        !shouldSpawnReplacement({
          childAlive,
          portOpen: await portOpen(baseUrl),
        })
      ) {
        if (!childAlive) {
          misses = 0;
          continue;
        }
      }
      if (childAlive && !shouldRestartHungChild(misses)) continue;
      if (childAlive) {
        await killProcessTree(spawned);
        spawned = null;
        misses = 0;
      }
      await recoverApi(baseUrl, gen);
    }
  }

  async function recoverApi(baseUrl: string, gen: number): Promise<void> {
    if (generation !== gen || quitting || recovering) return;
    if (serviceOwnsCatalog()) {
      publish({
        ...current,
        phase: "error",
        error: "Background service unavailable",
        message:
          "Background catalogue service is unavailable. Use Retry in Settings.",
      });
      return;
    }
    recovering = true;
    try {
      if (spawned && spawned.exitCode == null) {
        if (await canReach(baseUrl)) {
          await pollUntilSettled(baseUrl, gen);
        }
        return;
      }
      if (restartAttempts >= 5) {
        publish({
          phase: "error",
          message:
            "The catalog API stopped repeatedly. Use Retry on the loader.",
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: "Catalog API did not stay running.",
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
          catalogUsable: current.catalogUsable,
        });
        return;
      }
      restartAttempts += 1;
      publish({
        phase: "starting",
        message: "Catalog API stopped; restarting…",
        titleCount: current.titleCount,
        builtAt: current.builtAt,
        error: null,
        download: null,
        titlesUpdateAvailable: current.titlesUpdateAvailable,
        creditsFailed: current.creditsFailed,
        catalogUsable: current.catalogUsable,
      });
      await sleep(Math.min(800 * 2 ** (restartAttempts - 1), 8000));
      if (generation !== gen || quitting) return;
      if ((await canReach(baseUrl)) || (await portOpen(baseUrl))) {
        restartAttempts = 0;
        await pollUntilSettled(baseUrl, gen);
        return;
      }
      if (generation !== gen || quitting) return;
      const started = spawnApi(baseUrl);
      if (started.ok) spawned = started.child;
      const reached = await waitForReachable(baseUrl, gen);
      if (generation !== gen || quitting) return;
      if (!reached) {
        publish({
          phase: "error",
          message: unreachableMessage(),
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: "Catalog API did not become reachable.",
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
          catalogUsable: current.catalogUsable,
        });
        return;
      }
      await pollUntilSettled(baseUrl, gen);
    } finally {
      recovering = false;
    }
  }

  function spawnApi(
    baseUrl: string,
  ): { ok: true; child: ChildProcess } | { ok: false; message: string } {
    if (serviceOwnsCatalog())
      return {
        ok: false,
        message: "Catalogue is owned by the Windows service.",
      };
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
    if (!plan.ok) return plan;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: portFromUrl(baseUrl),
      RESCORE_CONTROL_TOKEN: controlToken,
      IMDB_DATA_DIR: plan.dataDir,
      CATALOG_DB_PATH: join(plan.dataDir, "catalog.sqlite"),
      CATALOG_REGION: store.getSettings().region.trim() || "US",
    };
    delete env.RESCORE_SERVICE_CONFIG;
    delete env.TMDB_API_KEYS;
    delete env.TMDB_API_KEY;
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env,
      stdio:
        plan.stdio === "inherit" ? ["ignore", "inherit", "inherit"] : "ignore",
      windowsHide: plan.windowsHide,
    });
    child.on("error", (error) => {
      console.error("[api] failed to start", error);
    });
    child.on("exit", (code, signal) => {
      if (spawned === child) spawned = null;
      if (!code) return;
      console.warn(`[api] exited (${code}${signal ? ` ${signal}` : ""})`);
      const baseUrl = catalogUrl(store);
      void (async () => {
        if (quitting || !(await canReach(baseUrl))) return;
        const health = await readHealth(baseUrl);
        if (health) publish(statusFromHealth(health));
      })();
    });
    return { ok: true, child };
  }

  function rebuild(): CatalogStatus {
    stopHydrationEvents();
    generation += 1;
    publish({
      phase: "building",
      message: "Rebuilding catalog from IMDb datasets…",
      titleCount: current.titleCount,
      builtAt: current.builtAt,
      error: null,
      download: null,
      titlesUpdateAvailable: current.titlesUpdateAvailable,
      creditsFailed: current.creditsFailed,
      catalogUsable: current.catalogUsable,
    });
    void runRebuild(generation);
    return current;
  }

  async function runRebuild(gen: number): Promise<void> {
    const baseUrl = catalogUrl(store);
    try {
      if (!(await canReach(baseUrl))) {
        if (generation !== gen) return;
        publish({
          phase: "error",
          message: unreachableMessage(),
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: "Catalog API did not become reachable.",
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
          catalogUsable: current.catalogUsable,
        });
        return;
      }
      const response = await catalogFetch(
        new URL("/v1/catalog/rebuild", `${baseUrl}/`),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ force: true }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (generation !== gen) return;
      if (!response.ok && response.status !== 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        publish({
          phase: "error",
          message: body?.error ?? "Could not start a catalog rebuild.",
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: body?.error ?? `Catalog rebuild failed (${response.status})`,
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
          catalogUsable: current.catalogUsable,
        });
        return;
      }
      startHydrationEvents(baseUrl, gen);
      await pollUntilSettled(baseUrl, gen);
      if (generation === gen && !quitting) void watchApi(baseUrl, gen);
    } catch (error) {
      if (generation !== gen) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({
        phase: "error",
        message: "Catalog rebuild failed.",
        titleCount: current.titleCount,
        builtAt: current.builtAt,
        error: message,
        download: null,
        titlesUpdateAvailable: current.titlesUpdateAvailable,
        creditsFailed: current.creditsFailed,
        catalogUsable: current.catalogUsable,
      });
    }
  }

  return {
    start,
    retry: start,
    rebuild,
    status: () => current,
    stop,
  };
}

function unreachableMessage(): string {
  if (app.isPackaged) {
    return "Cannot reach the local catalog API. Check the URL in Settings, then use Retry.";
  }
  return "Cannot reach the local catalog API. Check the URL in Settings or start it with npm run dev:api.";
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

async function canReach(baseUrl: string): Promise<boolean> {
  try {
    const response = await catalogFetch(new URL("/health", `${baseUrl}/`), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    const expected = serviceConnection();
    if (serviceOwnsCatalog())
      return (
        !!expected &&
        response.ok &&
        matchesServiceHealth(await response.json(), expected)
      );
    return response.status < 500 || response.status === 503;
  } catch {
    return false;
  }
}

async function readHealth(baseUrl: string): Promise<HealthPayload | null> {
  try {
    const response = await catalogFetch(new URL("/health", `${baseUrl}/`), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
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
