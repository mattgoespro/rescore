import type Database from "better-sqlite3";
import type { FacetsResponse } from "../catalog-types.js";

interface QueryCache {
  counts: Map<string, number>;
  facets: { value: FacetsResponse; expires: number } | null;
}
const connections = new WeakMap<Database.Database, QueryCache>();
export const FACETS_TTL_MS = 10 * 60 * 1000;

export function queryCache(db: Database.Database): QueryCache {
  let cache = connections.get(db);
  if (!cache) {
    cache = { counts: new Map(), facets: null };
    connections.set(db, cache);
  }
  return cache;
}

export function invalidateQueryCache(db: Database.Database): void {
  connections.delete(db);
}

export function invalidateCountCache(db: Database.Database): void {
  connections.get(db)?.counts.clear();
}
