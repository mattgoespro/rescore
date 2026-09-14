import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEV_RUNTIME_MISSING,
  PACKAGED_API_MISSING,
  planApiLaunch,
  type ApiLaunchContext,
} from "./api-launch";

const cwd = "/repo";
const apiRoot = join(cwd, "apps/api");
const packageJson = join(apiRoot, "package.json");
const source = join(apiRoot, "src", "index.ts");
const compiled = join(apiRoot, "dist", "index.js");
const tsx = join(apiRoot, "node_modules/tsx/dist/cli.mjs");
const bundledUnix = join(apiRoot, "bin", "node");
const bundledWin = join(apiRoot, "node.exe");
const npmNode = "/usr/local/bin/node";

function existsFrom(paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

function ctx(overrides: Partial<ApiLaunchContext> = {}): ApiLaunchContext {
  return {
    dev: true,
    packaged: false,
    localUrl: true,
    appPath: "/app",
    dirname: "/app/out/main",
    cwd,
    resourcesPath: "/resources",
    userDataDir: "/user-data",
    platform: "linux",
    ...overrides,
  };
}

test("DEV without npm_node_execpath falls back to PATH node when api root, tsx, and source exist", () => {
  const plan = planApiLaunch(
    ctx({ npmNodeExecPath: undefined }),
    existsFrom([packageJson, source, tsx]),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.command, "node");
  assert.deepEqual(plan.args, [tsx, source]);
  assert.equal(plan.cwd, apiRoot);
});

test("DEV on Windows without npm_node_execpath falls back to PATH node.exe", () => {
  const plan = planApiLaunch(
    ctx({ platform: "win32", npmNodeExecPath: undefined }),
    existsFrom([packageJson, source, tsx]),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.command, "node.exe");
});

test("bundled node is preferred over PATH and npm_node_execpath when present", () => {
  const plan = planApiLaunch(
    ctx({ npmNodeExecPath: npmNode }),
    existsFrom([packageJson, source, tsx, bundledUnix, npmNode]),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.command, bundledUnix);
});

test("bundled node.exe is preferred on Windows when present", () => {
  const plan = planApiLaunch(
    ctx({ platform: "win32", npmNodeExecPath: undefined }),
    existsFrom([packageJson, source, tsx, bundledWin]),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.command, bundledWin);
});

test("packaged launch without a runnable API reports PACKAGED_API_MISSING", () => {
  const plan = planApiLaunch(
    ctx({
      dev: false,
      packaged: true,
      npmNodeExecPath: undefined,
    }),
    existsFrom([packageJson, source]),
  );
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PACKAGED_API_MISSING);
  assert.notEqual(plan.message, DEV_RUNTIME_MISSING);
});

test("packaged launch with compiled API still uses bundled or PATH node", () => {
  const plan = planApiLaunch(
    ctx({
      dev: false,
      packaged: true,
      npmNodeExecPath: undefined,
    }),
    existsFrom([packageJson, compiled]),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.command, "node");
  assert.deepEqual(plan.args, [compiled]);
});
