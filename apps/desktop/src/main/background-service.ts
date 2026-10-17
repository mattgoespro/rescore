import { maintenanceActivity } from "./maintenance-activity";
import { createHash } from "node:crypto";
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BackgroundServiceStatus } from "../shared/background-service";
import type { ServiceInspection, ServiceIntent } from "./catalog-lifecycle";
import {
  runServiceMaintenance,
  serviceMaintenanceAction,
} from "./service-launch";
import {
  blockCatalogConnection,
  matchesServiceHealth,
  setServiceConnection,
  type ServiceConnection,
} from "./catalog-connection";

interface Installation {
  enabled: boolean;
  phase: string;
  serviceName: string;
  desktopRoot: string;
  runtime: string;
  originalDataDir: string;
  activated?: boolean;
  runtimeHash?: string;
}

let managed = false;
export function serviceRequired(): boolean {
  return process.platform === "win32" && app.isPackaged;
}
export function serviceOwnsCatalog(): boolean {
  return serviceRequired() || managed;
}

function powershell(code: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(code, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 30 * 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout) =>
        error
          ? reject(
              new Error(
                "Windows service operation failed or administrator approval was cancelled.",
              ),
            )
          : resolveResult(stdout.trim()),
    );
  });
}
const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export class BackgroundService {
  private ready = false;
  private root = "";
  private error: string | null = null;

  async initialize(): Promise<void> {
    if (process.platform !== "win32" || !app.isPackaged) return;
    blockCatalogConnection(true);
    this.root = join(process.env.ProgramData ?? "C:\\ProgramData", "Rescore");
    this.ready = true;
    this.reload();
  }

  private installation(): Installation | null {
    if (!this.root || !existsSync(join(this.root, "installation.json")))
      return null;
    const record = JSON.parse(
      readFileSync(join(this.root, "installation.json"), "utf8"),
    ) as Installation;
    if (record.serviceName !== "RescoreCatalogue") {
      throw new Error("Catalogue service profile does not match this app.");
    }
    return record;
  }

  private connection(): ServiceConnection {
    const value = JSON.parse(
      readFileSync(join(this.root, "config.json"), "utf8"),
    ) as ServiceConnection & { protocolVersion: number };
    if (
      value.protocolVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      !/^[a-f0-9-]{36}$/.test(value.catalogId) ||
      !Number.isInteger(value.port) ||
      value.port < 1024 ||
      value.port > 65535 ||
      typeof value.runtimeVersion !== "string"
    ) {
      throw new Error("Invalid catalogue service configuration.");
    }
    return value;
  }

  private reload(): void {
    // Fail closed: an unreadable/unfinished registration never permits a second API.
    managed = !!this.root && existsSync(join(this.root, "installation.json"));
    const record = this.installation();
    managed = record?.enabled === true;
    const connection = record?.enabled ? this.connection() : null;
    setServiceConnection(connection);
    blockCatalogConnection(
      serviceRequired() &&
        (!connection ||
          record?.phase !== "ready" ||
          connection.runtimeVersion !== app.getVersion()),
    );
  }

  async getStatus(): Promise<BackgroundServiceStatus> {
    const supported =
      process.platform === "win32" && process.arch === "x64" && app.isPackaged;
    if (!supported)
      return {
        supported: false,
        enabled: false,
        state: "not-installed",
        message: "Available in Windows x64 builds, installed or unpacked.",
      };
    const logsAvailable = !!this.root && existsSync(join(this.root, "logs"));
    try {
      this.reload();
      const record = this.installation();
      if (!record?.enabled)
        return {
          supported,
          logsAvailable,
          enabled: false,
          state: this.error ? "error" : "not-installed",
          message:
            this.error ??
            "Catalogue service needs registration. Use Retry to continue.",
        };
      if (record.phase !== "ready")
        return {
          supported,
          logsAvailable,
          enabled: true,
          state: "error",
          message:
            "An interrupted service transition needs recovery. Use Retry to continue.",
        };
      const config = this.connection();
      const state = await powershell(
        `$s = Get-Service -Name ${quote(record.serviceName)} -ErrorAction SilentlyContinue; if ($s) { $s.Status.ToString() } else { 'Missing' }`,
      );
      if (state !== "Running")
        return {
          supported,
          logsAvailable,
          enabled: true,
          state: "stopped",
          message:
            this.error ?? "Background catalogue service is stopped. Use Retry.",
          runtimeVersion: config.runtimeVersion,
        };
      const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok || !matchesServiceHealth(await response.json(), config))
        throw new Error(
          "Catalogue service identity or health check failed. Use Retry or open logs.",
        );
      if (config.runtimeVersion !== app.getVersion())
        throw new Error(
          "Catalogue service needs an update. Use Retry to update it.",
        );
      return {
        supported,
        logsAvailable,
        enabled: true,
        state: "running",
        message:
          this.error ?? "Catalogue upkeep continues when Rescore is closed.",
        runtimeVersion: config.runtimeVersion,
      };
    } catch (error) {
      return {
        supported,
        logsAvailable,
        enabled: managed,
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async inspect(intent: ServiceIntent): Promise<ServiceInspection> {
    if (!this.ready) await this.initialize();
    const status = await this.getStatus();
    if (!serviceRequired()) return { status, activity: "idle", action: "none" };
    const activity = await this.maintenanceActivity();
    if (intent === "observe") return { status, activity, action: "none" };
    if (intent === "launch" && status.state === "running")
      return { status, activity, action: "none" };
    try {
      const record = this.installation();
      const expectedHash = createHash("sha256")
        .update(
          readFileSync(
            join(process.resourcesPath, "api", "service-manifest.json"),
          ),
        )
        .digest("hex");
      const sameLocation = Boolean(
        record &&
        resolve(record.desktopRoot).toLowerCase() ===
          resolve(process.resourcesPath, "..").toLowerCase(),
      );
      const hashMatches =
        record?.runtimeHash?.toLowerCase() === expectedHash &&
        record?.activated !== false;
      let displayName: string | null = null;
      if (
        intent === "repair" &&
        status.state === "running" &&
        sameLocation &&
        hashMatches &&
        record
      ) {
        displayName = await powershell(
          `(Get-Service -Name ${quote(record.serviceName)} -ErrorAction Stop).DisplayName`,
        );
      }
      const action = serviceMaintenanceAction({
        intent,
        state: status.state,
        phase: record?.phase ?? null,
        sameLocation,
        hashMatches,
        displayName,
      });
      return { status, activity, action };
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      blockCatalogConnection(true);
      return {
        status: { ...status, state: "error", message: this.error },
        activity,
        action: "none",
      };
    }
  }

  private async maintenanceActivity(): Promise<ServiceInspection["activity"]> {
    return maintenanceActivity(join(this.root, "management.lock"));
  }

  async maintain(
    action: "EnsureRunning" | "Retry",
  ): Promise<BackgroundServiceStatus> {
    if (
      !this.ready ||
      !app.isPackaged ||
      process.platform !== "win32" ||
      process.arch !== "x64"
    )
      throw new Error(
        "Service requires a Windows x64 build, installed or unpacked.",
      );
    const launcher = join(
      process.resourcesPath,
      "service",
      "Rescore Maintenance.exe",
    );
    if (!existsSync(launcher))
      throw new Error("Service installer is missing. Reinstall Rescore.");
    this.error = null;
    blockCatalogConnection(true);
    const startedAt = Date.now();
    let resultDirectory: string | null = null;
    let confirmedComplete = false;
    try {
      const dataDir = resolve(app.getPath("userData"), "data");
      const expected = resolve(process.env.APPDATA ?? "", "Rescore", "data");
      if (dataDir.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          "The service requires the default local Windows profile location. Custom or redirected data folders are not supported.",
        );
      }
      resultDirectory = mkdtempSync(join(tmpdir(), "rescore-service-"));
      const resultPath = join(resultDirectory, "result.txt");
      writeFileSync(resultPath, "");
      await runServiceMaintenance(launcher, action, dataDir, resultPath);
      confirmedComplete = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      const errorFile = join(this.root, "last-error.txt");
      if (existsSync(errorFile) && statSync(errorFile).mtimeMs >= startedAt)
        this.error += ` ${readFileSync(errorFile, "utf8").slice(0, 1500)}`;
    } finally {
      // A timed-out broker can leave an elevated worker writing this result.
      if (resultDirectory && confirmedComplete)
        rmSync(resultDirectory, { recursive: true, force: true });
      try {
        this.reload();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        blockCatalogConnection(true);
      }
    }
    return this.getStatus();
  }

  async openLogs(): Promise<void> {
    if (!this.root) throw new Error("Service is not installed.");
    const error = await shell.openPath(join(this.root, "logs"));
    if (error) throw new Error(error);
  }
}
