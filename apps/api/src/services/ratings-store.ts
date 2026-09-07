import type { ImdbRating } from "../types.js";
import type { CatalogDatabase } from "./catalog-db.js";

export class RatingsStore {
  private ratings = new Map<string, ImdbRating>();
  private syncedAt: string | null = null;

  constructor(private readonly catalog?: CatalogDatabase) {}

  ready(): boolean {
    if (this.ratings.size > 0) return true;
    return Boolean(this.catalog?.catalogMeta().builtAt);
  }

  titleCount(): number {
    if (this.ratings.size > 0) return this.ratings.size;
    return this.catalog?.titleCount() ?? 0;
  }

  lastSyncedAt(): string | null {
    return this.syncedAt ?? this.catalog?.catalogMeta().builtAt ?? null;
  }

  replace(ratings: Map<string, ImdbRating>, syncedAt: string, persist = true): void {
    this.syncedAt = syncedAt;
    this.ratings = ratings;
    if (persist && this.catalog) {
      void this.catalog.upsertRatingsChunked(ratings).then(() => {
        this.ratings = new Map();
      });
    }
  }

  lookup(ids: string[]): Record<string, ImdbRating | null> {
    if (this.ratings.size > 0) {
      const ratings: Record<string, ImdbRating | null> = {};
      for (const id of ids) {
        ratings[id] = this.ratings.get(id.toLowerCase()) ?? null;
      }
      return ratings;
    }
    if (!this.catalog) {
      return Object.fromEntries(ids.map((id) => [id, null]));
    }
    const fromDb = this.catalog.ratings(ids);
    return Object.fromEntries(
      ids.map((id) => [id, fromDb[id.toLowerCase()] ?? fromDb[id] ?? null]),
    );
  }

  forIds(ids: string[]): Map<string, ImdbRating> {
    const matched = new Map<string, ImdbRating>();
    if (this.ratings.size > 0) {
      for (const id of ids) {
        const rating = this.ratings.get(id.toLowerCase());
        if (rating) matched.set(id.toLowerCase(), rating);
      }
      return matched;
    }
    if (!this.catalog) return matched;
    const fromDb = this.catalog.ratings(ids);
    for (const id of ids) {
      const rating = fromDb[id.toLowerCase()] ?? fromDb[id];
      if (rating) matched.set(id.toLowerCase(), rating);
    }
    return matched;
  }
}
