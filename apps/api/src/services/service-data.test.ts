import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { acquireCatalogOwnership } from "./catalog-ownership.js";

test("data handoff preserves WAL data, library values, cache, and source; refuses an active owner", () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-service-copy-"));
  const source = join(dir, "source"),
    target = join(dir, "target");
  mkdirSync(source);
  mkdirSync(join(source, "posters"));
  const path = join(source, "catalog.sqlite");
  const db = new Database(path);
  const copy = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../scripts/service-data.ts", import.meta.url)),
        source,
        target,
      ],
      { windowsHide: true, encoding: "utf8" },
    );
  try {
    db.pragma("journal_mode = WAL");
    db.exec(
      "CREATE TABLE library(id TEXT PRIMARY KEY, rating INTEGER, note TEXT); INSERT INTO library VALUES ('tt1',9,'Keep this note'); CREATE TABLE checkpoint(n INTEGER); INSERT INTO checkpoint VALUES (42)",
    );
    writeFileSync(join(source, "posters", "fixture.jpg"), "cached-image");
    writeFileSync(join(source, "incomplete.tmp"), "partial");
    const unlock = acquireCatalogOwnership(path);
    try {
      assert.notEqual(copy().status, 0, "Live catalogue cannot be copied");
    } finally {
      unlock();
    }
    const result = copy();
    assert.equal(result.status, 0, result.stderr);
    const cloned = new Database(join(target, "catalog.sqlite"));
    try {
      assert.deepEqual(
        cloned.prepare("SELECT * FROM library").all(),
        db.prepare("SELECT * FROM library").all(),
      );
      assert.equal(
        (cloned.prepare("SELECT n FROM checkpoint").get() as { n: number }).n,
        42,
      );
      assert.equal(cloned.pragma("integrity_check", { simple: true }), "ok");
      cloned.exec("UPDATE library SET rating=10");
      assert.equal(
        (db.prepare("SELECT rating FROM library").get() as { rating: number })
          .rating,
        9,
      );
    } finally {
      cloned.close();
    }
    assert.equal(
      readFileSync(join(target, "posters", "fixture.jpg"), "utf8"),
      "cached-image",
    );
    assert.throws(() => readFileSync(join(target, "incomplete.tmp")));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
