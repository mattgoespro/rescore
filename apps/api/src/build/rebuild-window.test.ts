import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CatalogDatabase } from "../catalog/database.js";
import { withCreditsWrite } from "./rebuild-window.js";

const dirs: string[] = [];

function openCatalog(): CatalogDatabase {
  const dir = mkdtempSync(join(tmpdir(), "rescore-rebuild-"));
  dirs.push(dir);
  return new CatalogDatabase(join(dir, "catalog.sqlite"));
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("credits write sets the flag only after success", async () => {
  const catalog = openCatalog();
  await assert.rejects(
    withCreditsWrite(catalog, async () => {
      throw new Error("scan failed");
    }),
  );
  assert.equal(catalog.creditsReady(), false);
  await withCreditsWrite(catalog, async () => {});
  assert.equal(catalog.creditsReady(), true);
  catalog.close();
});
