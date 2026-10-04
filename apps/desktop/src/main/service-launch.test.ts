import assert from "node:assert/strict";
import { test } from "node:test";
import { elevationCommand, serviceMaintenanceAction } from "./service-launch";

const runningElsewhere = {
  intent: "launch" as const,
  state: "running" as const,
  phase: "ready",
  sameLocation: false,
  hashMatches: false,
  displayName: null,
};

test("launch connects to a running service without maintenance", () => {
  assert.equal(serviceMaintenanceAction(runningElsewhere), "none");
});

test("repair updates a running service whose app location or runtime changed", () => {
  assert.equal(
    serviceMaintenanceAction({ ...runningElsewhere, intent: "repair" }),
    "EnsureRunning",
  );
});

test("repair leaves a matching running service alone", () => {
  assert.equal(
    serviceMaintenanceAction({
      intent: "repair",
      state: "running",
      phase: "ready",
      sameLocation: true,
      hashMatches: true,
      displayName: "Rescore API",
    }),
    "none",
  );
});

test("a ready service that failed its health check is retried", () => {
  assert.equal(
    serviceMaintenanceAction({
      intent: "launch",
      state: "error",
      phase: "ready",
      sameLocation: true,
      hashMatches: true,
      displayName: "Rescore API",
    }),
    "Retry",
  );
});

test("a stopped service is started", () => {
  assert.equal(
    serviceMaintenanceAction({
      intent: "launch",
      state: "stopped",
      phase: "ready",
      sameLocation: true,
      hashMatches: true,
      displayName: "Rescore API",
    }),
    "EnsureRunning",
  );
});

test("elevation hides the administrator powershell and ignores a missing exit code", () => {
  const command = elevationCommand("QQ==");
  assert.match(
    command,
    /-ArgumentList @\('-NoProfile','-WindowStyle','Hidden','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','QQ=='\)/,
  );
  assert.doesNotMatch(command, /-WindowStyle Hidden -Wait/);
  assert.match(
    command,
    /if \(\$null -ne \$p\.ExitCode -and \$p\.ExitCode -ne 0\)/,
  );
  assert.doesNotMatch(command, /if \(\$p\.ExitCode -ne 0\)/);
});
