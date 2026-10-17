import type { BackgroundServiceStatus } from "../shared/background-service";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

export type ServiceLaunchIntent = "launch" | "repair";
export type ServiceMaintenanceAction = "none" | "EnsureRunning" | "Retry";

export function serviceMaintenanceAction(input: {
  intent: ServiceLaunchIntent;
  state: BackgroundServiceStatus["state"];
  phase: string | null;
  sameLocation: boolean;
  hashMatches: boolean;
  displayName: string | null;
}): ServiceMaintenanceAction {
  // A healthy running service is already the catalogue. Launch must use it
  // instead of opening an administrator shell and blocking the splash.
  if (input.intent === "launch" && input.state === "running") return "none";
  if (
    input.state === "running" &&
    input.sameLocation &&
    input.hashMatches &&
    input.displayName === "Rescore API"
  ) {
    return "none";
  }
  if (input.state === "error" && input.phase === "ready") return "Retry";
  return "EnsureRunning";
}

/** The GUI broker elevates itself and creates PowerShell with CREATE_NO_WINDOW. */
export function runServiceMaintenance(
  launcher: string,
  action: "EnsureRunning" | "Retry",
  dataDir: string,
  resultPath: string,
): Promise<void> {
  return new Promise((resolveResult, reject) => {
    execFile(
      launcher,
      ["--action", action, "--data-dir", dataDir, "--result", resultPath],
      { windowsHide: true, timeout: 30 * 60_000, maxBuffer: 1024 * 1024 },
      (error) => {
        try {
          // Approval cancellation, a missing result, and nonzero results fail closed.
          if (error || readFileSync(resultPath, "utf8").trim() !== "0") {
            throw new Error("Windows service operation failed or administrator approval was cancelled.");
          }
          resolveResult();
        } catch (failure) { reject(failure); }
      },
    );
  });
}
