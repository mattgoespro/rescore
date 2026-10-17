import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  lstatSync,
  statfsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { acquireCatalogOwnership } from "../services/catalog-ownership.js";

// Runs only from the fixed elevated service helper, with both API processes stopped.
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error("Source and target required");
const source = resolve(sourceArg),
  target = resolve(targetArg);
const sourceKey = process.platform === "win32" ? source.toLowerCase() : source;
const targetKey = process.platform === "win32" ? target.toLowerCase() : target;
if (
  sourceKey === targetKey ||
  targetKey.startsWith(sourceKey + "/") ||
  targetKey.startsWith(sourceKey + "\\")
)
  throw new Error("Invalid copy target");
mkdirSync(source, { recursive: true });
mkdirSync(target, { recursive: true });
const releases = [acquireCatalogOwnership(join(source, "catalog.sqlite"))];
try {
  releases.push(acquireCatalogOwnership(join(target, "catalog.sqlite")));
  function size(path: string): number {
    const info = lstatSync(path);
    if (info.isSymbolicLink())
      throw new Error("Catalogue transfer does not follow links");
    if (info.isFile() && info.nlink > 1)
      throw new Error("Catalogue transfer does not follow hard links");
    return info.isDirectory()
      ? readdirSync(path).reduce(
          (sum, child) => sum + size(join(path, child)),
          0,
        )
      : info.size;
  }
  const bytes = size(source),
    disk = statfsSync(target);
  if (disk.bavail * disk.bsize < bytes + 64 * 1024 * 1024)
    throw new Error("Insufficient disk space for catalogue transfer");
  const dbPath = join(source, "catalog.sqlite");
  if (existsSync(dbPath)) {
    const db = new Database(dbPath);
    try {
      if (db.pragma("integrity_check", { simple: true }) !== "ok")
        throw new Error("Source catalogue integrity check failed");
      await db.backup(join(target, "catalog.sqlite"));
    } finally {
      db.close();
    }
  }
  for (const file of readdirSync(source)) {
    if (/^catalog\.sqlite(?:$|-|\.owner\.)/.test(file) || file.endsWith(".tmp"))
      continue;
    cpSync(join(source, file), join(target, file), {
      recursive: true,
      dereference: false,
    });
  }
  if (existsSync(join(target, "catalog.sqlite"))) {
    const db = new Database(join(target, "catalog.sqlite"), { readonly: true });
    try {
      if (db.pragma("integrity_check", { simple: true }) !== "ok")
        throw new Error("Copied catalogue integrity check failed");
    } finally {
      db.close();
    }
  }
} finally {
  for (const release of releases.reverse()) release();
}
