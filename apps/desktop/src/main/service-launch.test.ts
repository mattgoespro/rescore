import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runServiceMaintenance, serviceMaintenanceAction } from "./service-launch";
import { readFileSync } from "node:fs";

test("lifecycle elevation targets a windowless broker instead of PowerShell", () => {
  const source = readFileSync(join(__dirname, "service-launch.ts"), "utf8");
  assert.doesNotMatch(source, /-Verb RunAs/);
  assert.match(source, /runServiceMaintenance/);
});

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

test(
  "GUI maintenance failures and missing completion records cannot appear successful",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rescore-elevation-test-"));
    const result = join(directory, "O'Brien result.txt");
    try {
      const source = join(directory, "fixture.cs");
      const launcher = join(directory, "O'Brien GUI helper.exe");
      writeFileSync(source, `using System.IO;
        class Fixture { static int Main(string[] args) {
          if (args.Length != 6 || args[0] != "--action" || args[1] != "EnsureRunning" || args[4] != "--result") return 9;
          if (args[3] == "missing") return 0;
          File.WriteAllText(args[5], args[3] == "exit-failure" ? "0" : args[3]);
          return args[3] == "exit-failure" ? 4 : 0;
        } }`);
      const compile = spawnSync(
        join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
        ["/nologo", "/target:winexe", `/out:${launcher}`, source],
        { windowsHide: true, encoding: "utf8" },
      );
      assert.equal(compile.status, 0, compile.stdout + compile.stderr);
      for (const reported of ["", "1", "garbage", "missing", "exit-failure", "0"]) {
        rmSync(result, { force: true });
        const operation = runServiceMaintenance(launcher, "EnsureRunning", reported, result);
        if (reported === "0") await operation;
        else await assert.rejects(operation);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
