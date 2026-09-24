import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { is } from "@electron-toolkit/utils";
import {
  DEFAULT_CATALOG_API_URL,
  type CatalogPhase,
  type CatalogStatus,
} from "../shared/types";
import { shouldRestartHungChild } from "./api-watch";
import { planApiLaunch } from "./api-launch";
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
  };
  let generation = 0;
  let spawned: ChildProcess | null = null;
  let adoptedPid: number | null = null;
  let quitting = false;
  let restartAttempts = 0;
  let recovering = false;

  const publish = (next: CatalogStatus): void => {
    current = next;
    getWindow()?.webContents.send("catalog:status", next);
  };

  const run = (gen: number): void => {
    void bootstrap(gen);
  };

  const start = (): void => {
    generation += 1;
    restartAttempts = 0;
    run(generation);
  };

  async function stop(): Promise<void> {
    quitting = true;
    generation += 1;
    const child = spawned;
    const pid = adoptedPid;
    spawned = null;
    adoptedPid = null;
    await killProcessTree(child);
    if (pid && pid !== child?.pid) await killPid(pid);
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
    });

    const baseUrl = catalogUrl(store);
    try {
      if (!(await canReach(baseUrl))) {
        if (!spawned || spawned.exitCode != null) {
          await killProcessTree(spawned);
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
            });
            return;
          }
          spawned = started.child;
          adoptedPid = null;
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
        });
      } else if (isLocalUrl(baseUrl) && !spawned) {
        adoptedPid = await listeningPid(portFromUrl(baseUrl));
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
        });
        return;
      }

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

  async function waitForReachable(baseUrl: string, gen: number): Promise<boolean> {
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
        if (!childAlive && missed >= 8) {
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
        });
        await sleep(POLL_MS);
        continue;
      }
      missed = 0;
      restartAttempts = 0;
      const next = statusFromHealth(health);
      publish(next);
      if (next.phase === "ready" || next.phase === "error") return;
      await sleep(next.download ? 200 : POLL_MS);
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
          message: "The catalog API stopped repeatedly. Use Retry on the loader.",
          titleCount: current.titleCount,
          builtAt: current.builtAt,
          error: "Catalog API did not stay running.",
          download: null,
          titlesUpdateAvailable: current.titlesUpdateAvailable,
          creditsFailed: current.creditsFailed,
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
      });
      await sleep(Math.min(800 * 2 ** (restartAttempts - 1), 8000));
      if (generation !== gen || quitting) return;
      if (await canReach(baseUrl)) {
        restartAttempts = 0;
        await pollUntilSettled(baseUrl, gen);
        return;
      }
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
        });
        return;
      }
      await pollUntilSettled(baseUrl, gen);
    } finally {
      recovering = false;
    }
  }

  function spawnApi(baseUrl: string):
    | { ok: true; child: ChildProcess }
    | { ok: false; message: string } {
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
    const tmdbApiKey = store.getSettings().tmdbApiKey.trim();
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: {
        ...process.env,
        PORT: portFromUrl(baseUrl),
        IMDB_DATA_DIR: plan.dataDir,
        CATALOG_DB_PATH: join(plan.dataDir, "catalog.sqlite"),
        ...(tmdbApiKey ? { TMDB_API_KEY: tmdbApiKey } : {}),
        CATALOG_REGION: store.getSettings().region.trim() || "US",
      },
      stdio: plan.stdio === "inherit" ? ["ignore", "inherit", "inherit"] : "ignore",
      windowsHide: plan.windowsHide,
    });
    child.on("error", (error) => {
      console.error("[api] failed to start", error);
    });
    child.on("exit", (code, signal) => {
      if (spawned === child) spawned = null;
      if (code && code !== 0) {
        console.warn(`[api] exited (${code}${signal ? ` ${signal}` : ""})`);
      }
    });
    return { ok: true, child };
  }

  function rebuild(): CatalogStatus {
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
        });
        return;
      }
      const response = await fetch(new URL("/v1/catalog/rebuild", `${baseUrl}/`), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force: true }),
        signal: AbortSignal.timeout(8000),
      });
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
        });
        return;
      }
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
  const raw = store.getSettings().catalogApiUrl.trim();
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

async function canReach(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", `${baseUrl}/`), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    return response.status < 500 || response.status === 503;
  } catch {
    return false;
  }
}

async function readHealth(baseUrl: string): Promise<HealthPayload | null> {
  try {
    const response = await fetch(new URL("/health", `${baseUrl}/`), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    return (await response.json()) as HealthPayload;
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
  else if (health.catalogPhase === "building" || health.building) phase = "building";
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
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killProcessTree(child: ChildProcess | null): Promise<void> {
  if (!child?.pid) return;
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

async function listeningPid(port: string): Promise<number | null> {
  if (process.platform !== "win32") return null;
  const stdout = await execFileNoThrow("netstat", ["-ano", "-p", "tcp"]);
  if (!stdout) return null;
  const suffix = `:${port}`;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] ?? "";
    if (!local.endsWith(suffix)) continue;
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

function execFileNoThrow(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout ?? ""));
    });
  });
}
