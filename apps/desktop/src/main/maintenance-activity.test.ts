import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintenanceActivity } from "./maintenance-activity";

test(
  "maintenance observation distinguishes a leftover file from an active exclusive Windows lock",
  { skip: process.platform !== "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "rescore-lock-observation-"));
    const lock = join(dir, "management.lock");
    try {
      assert.equal(maintenanceActivity(lock), "idle");
      writeFileSync(lock, "");
      assert.equal(maintenanceActivity(lock), "idle");
      const script = join(dir, "probe.cjs");
      const module = join(process.cwd(), "src/main/maintenance-activity.ts");
      writeFileSync(
        script,
        `const {maintenanceActivity}=require(${JSON.stringify(module)});console.log(maintenanceActivity(${JSON.stringify(lock)}));`,
      );
      const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
      const code = `$f=[IO.File]::Open(${quote(lock)},[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try { & ${quote(process.execPath)} --import tsx ${quote(script)};exit $LASTEXITCODE } finally { $f.Dispose() }`;
      const result = spawnSync(
        join(
          process.env.SystemRoot ?? "C:/Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        ["-NoProfile", "-NonInteractive", "-Command", code],
        { encoding: "utf8", timeout: 10000, windowsHide: true },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "busy");
      assert.equal(maintenanceActivity(lock), "idle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
