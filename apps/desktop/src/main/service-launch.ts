import type { BackgroundServiceStatus } from "../shared/background-service";

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

/** Child powershell.exe must be hidden. Start-Process -WindowStyle is ignored with -Verb RunAs. */
export function elevationCommand(encodedCommand: string): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(encodedCommand)) {
    throw new Error("Invalid elevated command.");
  }
  return [
    "$ErrorActionPreference='Stop'",
    `$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -PassThru -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}')`,
    "if ($null -eq $p) { exit 1 }",
    "$null = $p.Handle",
    "if (-not $p.WaitForExit(1800000)) { exit 1 }",
    "if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) { exit 1 }",
  ].join("; ");
}
