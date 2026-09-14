import { join } from "node:path";

export const NON_LOCAL_URL =
  "The catalog API URL is not local, so Rescore cannot start it. Confirm the URL in Settings.";
export const PACKAGED_API_MISSING =
  "Cannot find the catalog API runtime. Reinstall Rescore.";
export const DEV_API_MISSING =
  "Cannot find the catalog API. Start it with npm run dev:api, then relaunch Rescore.";
export const DEV_RUNTIME_MISSING =
  "Cannot start the catalog API (Node or tsx is missing). Run npm install and npm run dev:api.";

export interface ApiLaunchContext {
  dev: boolean;
  packaged: boolean;
  localUrl: boolean;
  appPath: string;
  dirname: string;
  cwd: string;
  resourcesPath: string;
  userDataDir: string;
  npmNodeExecPath?: string;
  platform: NodeJS.Platform;
}

export interface ApiLaunchSuccess {
  ok: true;
  command: string;
  args: string[];
  cwd: string;
  dataDir: string;
  stdio: "ignore" | "inherit";
  windowsHide: true;
}

export interface ApiLaunchFailure {
  ok: false;
  message: string;
}

export type ApiLaunchPlan = ApiLaunchSuccess | ApiLaunchFailure;

export function planApiLaunch(
  ctx: ApiLaunchContext,
  exists: (path: string) => boolean,
): ApiLaunchPlan {
  if (!ctx.localUrl) return { ok: false, message: NON_LOCAL_URL };

  const apiRoot = resolveApiRoot(ctx, exists);
  if (!apiRoot) {
    return {
      ok: false,
      message: ctx.packaged ? PACKAGED_API_MISSING : DEV_API_MISSING,
    };
  }

  const command = resolveNode(ctx, apiRoot, exists);
  const args = resolveArgs(ctx, apiRoot, exists);
  if (!command || !args) {
    return {
      ok: false,
      message: ctx.packaged ? PACKAGED_API_MISSING : DEV_RUNTIME_MISSING,
    };
  }

  return {
    ok: true,
    command,
    args,
    cwd: apiRoot,
    dataDir: ctx.dev ? join(apiRoot, "data") : join(ctx.userDataDir, "data"),
    stdio: ctx.dev ? "inherit" : "ignore",
    windowsHide: true,
  };
}

function resolveApiRoot(
  ctx: ApiLaunchContext,
  exists: (path: string) => boolean,
): string | null {
  const candidates = [
    join(ctx.resourcesPath, "api"),
    join(ctx.appPath, "../api"),
    join(ctx.dirname, "../../../api"),
    join(ctx.cwd, "apps/api"),
    join(ctx.cwd, "../api"),
  ];
  return (
    candidates.find((dir) => {
      if (!exists(join(dir, "package.json"))) return false;
      return (
        exists(join(dir, "dist", "index.js")) ||
        exists(join(dir, "src", "index.ts"))
      );
    }) ?? null
  );
}

function resolveNode(
  ctx: ApiLaunchContext,
  apiRoot: string,
  exists: (path: string) => boolean,
): string | null {
  const bundled =
    ctx.platform === "win32"
      ? join(apiRoot, "node.exe")
      : join(apiRoot, "bin", "node");
  if (exists(bundled)) return bundled;
  if (ctx.npmNodeExecPath && exists(ctx.npmNodeExecPath)) {
    return ctx.npmNodeExecPath;
  }
  return ctx.platform === "win32" ? "node.exe" : "node";
}

function resolveArgs(
  ctx: ApiLaunchContext,
  apiRoot: string,
  exists: (path: string) => boolean,
): string[] | null {
  const compiled = join(apiRoot, "dist", "index.js");
  if (!ctx.dev && exists(compiled)) return [compiled];

  const source = join(apiRoot, "src", "index.ts");
  const tsx = resolveTsx(apiRoot, exists);
  if (tsx && exists(source)) return [tsx, source];
  return null;
}

function resolveTsx(
  apiRoot: string,
  exists: (path: string) => boolean,
): string | null {
  const candidates = [
    join(apiRoot, "node_modules/tsx/dist/cli.mjs"),
    join(apiRoot, "../../node_modules/tsx/dist/cli.mjs"),
    join(apiRoot, "node_modules/tsx/dist/cli.cjs"),
    join(apiRoot, "../../node_modules/tsx/dist/cli.cjs"),
  ];
  return candidates.find((file) => exists(file)) ?? null;
}
