import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireCatalogOwnership } from "./catalog-ownership.js";

test("catalogue ownership excludes a second owner and releases on close", () => {
  const directory = mkdtempSync(join(tmpdir(), "rescore-ownership-"));
  const path = join(directory, "catalog.sqlite");
  const release = acquireCatalogOwnership(path);
  try {
    assert.throws(() => acquireCatalogOwnership(path), /Another process owns/);
    release();
    release();
    acquireCatalogOwnership(path)();
  } finally {
    release();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in-memory catalogues have independent owners", () => {
  const first = acquireCatalogOwnership(":memory:");
  const second = acquireCatalogOwnership(":memory:");
  first();
  second();
});

test(
  "a forcibly terminated process releases catalogue ownership",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "rescore-ownership-crash-"));
    const path = join(directory, "catalog.sqlite");
    const moduleUrl = new URL("./catalog-ownership.ts", import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { acquireCatalogOwnership } from ${JSON.stringify(moduleUrl)};
     acquireCatalogOwnership(process.argv[1]);
     process.stdout.write('owned');
     setInterval(() => {}, 1000);`,
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exit = once(child, "exit");
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      const ready = await Promise.race([
        once(child.stdout, "data").then(() => true),
        exit.then(() => false),
      ]);
      assert.ok(
        ready,
        `Ownership child exited before acquiring lock: ${diagnostics}`,
      );
      assert.throws(
        () => acquireCatalogOwnership(path),
        /Another process owns/,
      );
      assert.ok(child.kill("SIGKILL"));
      await exit;
      acquireCatalogOwnership(path)();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exit;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
