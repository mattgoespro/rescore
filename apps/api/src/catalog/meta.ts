import type Database from "better-sqlite3";
import type { CatalogMeta, CatalogReadiness } from "./types.js";

export function readCatalogMeta(db: Database.Database): CatalogMeta {
  const rows = db
    .prepare("SELECT key, value FROM catalog_meta")
    .all() as Array<{ key: string; value: string }>;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    builtAt: values.builtAt ?? null,
    revision: values.revision ?? null,
    source: values.source ?? null,
  };
}

export function writeCatalogMeta(
  db: Database.Database,
  meta: { builtAt: string; revision: string; source: string },
): void {
  const upsert = db.prepare(
    "INSERT INTO catalog_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  db.transaction(() => {
    upsert.run("builtAt", meta.builtAt);
    upsert.run("revision", meta.revision);
    upsert.run("source", meta.source);
    upsert.run("titlesReady", "1");
  })();
}

export function setFlag(
  db: Database.Database,
  key: string,
  running: boolean,
): void {
  if (running) {
    db.prepare(
      "INSERT INTO catalog_meta(key, value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key);
    return;
  }
  db.prepare("DELETE FROM catalog_meta WHERE key = ?").run(key);
}

export function flagIsSet(db: Database.Database, key: string): boolean {
  const row = db
    .prepare("SELECT value FROM catalog_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value === "1";
}

export function readiness(db: Database.Database): CatalogReadiness {
  const titleCount = (
    db.prepare("SELECT count(*) AS count FROM titles").get() as { count: number }
  ).count;
  const builtAt = readCatalogMeta(db).builtAt;
  const titlesReady = titleCount > 0 && Boolean(builtAt);
  if (flagIsSet(db, "creditsReady")) {
    return { titlesReady, creditsReady: true };
  }
  const hasPeople = Boolean(
    db.prepare("SELECT 1 FROM title_people LIMIT 1").get(),
  );
  return { titlesReady, creditsReady: hasPeople };
}
