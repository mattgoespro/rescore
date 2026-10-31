import type Database from "better-sqlite3";
import type { FacetsResponse } from "../catalog-types.js";

interface QueryCache {
  counts: CountCache;
  facets: { value: FacetsResponse; expires: number } | null;
}
const connections = new WeakMap<Database.Database, QueryCache>();
export const FACETS_TTL_MS = 10 * 60 * 1000;
/**
 * Each search text and filter set is a key, and the service runs for weeks,
 * so only the most recently used totals are kept.
 */
export const COUNT_CACHE_LIMIT = 500;

export class CountCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly limit = COUNT_CACHE_LIMIT) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): number | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: number): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit)
      this.entries.delete(this.entries.keys().next().value as string);
  }

  clear(): void {
    this.entries.clear();
  }
}

export function queryCache(db: Database.Database): QueryCache {
  let cache = connections.get(db);
  if (!cache) {
    cache = { counts: new CountCache(), facets: null };
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
