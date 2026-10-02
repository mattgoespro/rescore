import Database from "better-sqlite3";

/** SQLite releases this separate process lock even after a crash or forced stop. */
export function acquireCatalogOwnership(path: string): () => void {
  if (path === ":memory:") return () => undefined;
  const lock = new Database(`${path}.owner.sqlite`);
  try {
    lock.pragma("busy_timeout = 0");
    lock.exec("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error(
      "Another process owns this catalogue. Stop it before opening the catalogue.",
    );
  }
  return () => {
    if (lock.open) lock.close();
  };
}
