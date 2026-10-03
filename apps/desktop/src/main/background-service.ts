import { createHash } from "node:crypto";
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BackgroundServiceStatus } from "../shared/background-service";
import type { CatalogRuntime } from "./catalog-runtime";
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
  ownerSid: string;
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
  private sid = "";
  private root = "";
  private busy = false;
  private error: string | null = null;
  private runtime: CatalogRuntime | null = null;
  private ensuring: Promise<BackgroundServiceStatus> | null = null;

  async initialize(): Promise<void> {
    if (process.platform !== "win32" || !app.isPackaged) return;
    blockCatalogConnection(true);
    this.sid = await powershell(
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    );
    if (!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(this.sid))
      throw new Error("Unsupported Windows profile");
    this.root = join(
      process.env.ProgramData ?? "C:\\ProgramData",
      "Rescore",
      this.sid,
    );
    this.reload();
  }

  attach(runtime: CatalogRuntime): void {
    this.runtime = runtime;
  }

  private installation(): Installation | null {
    if (!this.root || !existsSync(join(this.root, "installation.json")))
      return null;
    const record = JSON.parse(
      readFileSync(join(this.root, "installation.json"), "utf8"),
    ) as Installation;
    if (
      record.ownerSid !== this.sid ||
      record.serviceName !== `RescoreCatalogue-${this.sid}` ||
      resolve(record.originalDataDir).toLowerCase() !==
        resolve(app.getPath("userData"), "data").toLowerCase()
    ) {
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
    if (this.busy)
      return {
        supported,
        logsAvailable,
        enabled: managed,
        state: "transitioning",
        message:
          "Preparing the required catalogue service. Please keep Rescore open.",
      };
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

  ensureRunning(): Promise<BackgroundServiceStatus> {
    if (this.ensuring) return this.ensuring;
    this.ensuring = this.runEnsureRunning().finally(() => {
      this.ensuring = null;
    });
    return this.ensuring;
  }

  private async runEnsureRunning(): Promise<BackgroundServiceStatus> {
    if (!serviceRequired()) return this.getStatus();
    try {
      if (!this.sid) await this.initialize();
      const status = await this.getStatus();
      const record = this.installation();
      const expectedHash = createHash("sha256")
        .update(
          readFileSync(
            join(process.resourcesPath, "api", "service-manifest.json"),
          ),
        )
        .digest("hex");
      const sameLocation =
        record &&
        resolve(record.desktopRoot).toLowerCase() ===
          resolve(process.resourcesPath, "..").toLowerCase();
      if (
        status.state === "running" &&
        sameLocation &&
        record?.activated !== false &&
        record?.runtimeHash?.toLowerCase() === expectedHash
      ) {
        const displayName = await powershell(
          `(Get-Service -Name ${quote(record.serviceName)} -ErrorAction Stop).DisplayName`,
        );
        if (displayName === "Rescore API") return status;
      }
      return await this.change(
        status.state === "error" && record?.phase === "ready"
          ? "Retry"
          : "EnsureRunning",
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      blockCatalogConnection(true);
      return {
        supported: true,
        enabled: managed,
        state: "error",
        message: this.error,
      };
    }
  }

  async change(
    action: "EnsureRunning" | "Retry",
  ): Promise<BackgroundServiceStatus> {
    if (this.busy) throw new Error("A service operation is already running.");
    if (
      !this.sid ||
      !app.isPackaged ||
      process.platform !== "win32" ||
      process.arch !== "x64"
    )
      throw new Error(
        "Service requires a Windows x64 build, installed or unpacked.",
      );
    const script = join(process.resourcesPath, "service", "manage-service.ps1");
    if (!existsSync(script))
      throw new Error("Service installer is missing. Reinstall Rescore.");
    this.busy = true;
    this.error = null;
    blockCatalogConnection(true);
    try {
      {
        const profile = await powershell(
          `[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath ${quote(`HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\${this.sid}`)}).ProfileImagePath)`,
        );
        const expected = resolve(
          profile,
          "AppData",
          "Roaming",
          "Rescore",
          "data",
        );
        if (
          resolve(app.getPath("userData"), "data").toLowerCase() !==
          expected.toLowerCase()
        ) {
          throw new Error(
            "The service requires the default local Windows profile location. Custom or redirected data folders are not supported.",
          );
        }
      }
      await this.runtime?.stop();
      // Encoded command keeps paths and apostrophes out of shell argument parsing.
      const elevated = `& ${quote(script)} -Action ${action} -OwnerSid ${quote(this.sid)}; exit $LASTEXITCODE`;
      const encoded = Buffer.from(elevated, "utf16le").toString("base64");
      await powershell(
        `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',${quote(encoded)}); if ($p.ExitCode -ne 0) { exit 1 }`,
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      const errorFile = join(this.root, "last-error.txt");
      if (existsSync(errorFile))
        this.error += ` ${readFileSync(errorFile, "utf8").slice(0, 1500)}`;
    } finally {
      this.busy = false;
      try {
        this.reload();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        blockCatalogConnection(true);
      }
      this.runtime?.start();
    }
    return this.getStatus();
  }

  async openLogs(): Promise<void> {
    if (!this.root) throw new Error("Service is not installed.");
    const error = await shell.openPath(join(this.root, "logs"));
    if (error) throw new Error(error);
  }
}
