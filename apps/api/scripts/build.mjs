import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(appRoot, "dist");
if (dirname(output) !== resolve(appRoot))
  throw new Error("Invalid API output directory");
// Removing generated output prevents relocated tooling from lingering in packages.
rmSync(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "-p",
    join(appRoot, "tsconfig.build.json"),
    "--pretty",
    "false",
  ],
  { cwd: appRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
