import { catalogFetch, effectiveCatalogUrl } from "./catalog-connection";
import { DEFAULT_IMDB_API_URL } from "../shared/types";

export interface ImdbRating {
  rating: number;
  votes: number;
}

interface RatingsResponse {
  syncedAt?: string;
  ratings?: Record<string, ImdbRating | null>;
}

export function ratingsApiUrl(settingsUrl?: string): string {
  const raw = process.env.IMDB_API_URL || settingsUrl || DEFAULT_IMDB_API_URL;
  return raw.trim().replace(/\/+$/, "") || DEFAULT_IMDB_API_URL;
}

export class ImdbRatingsClient {
  constructor(private baseUrl: string) {}

  async lookup(ids: string[]): Promise<Map<string, ImdbRating>> {
    const unique = [
      ...new Set(
        ids.map((id) => id.trim()).filter((id) => /^tt\d+$/i.test(id)),
      ),
    ];
    if (!unique.length) return new Map();

    const found = new Map<string, ImdbRating>();
    try {
      for (let index = 0; index < unique.length; index += 200) {
        const chunk = unique.slice(index, index + 200);
        const response = await catalogFetch(`${effectiveCatalogUrl(this.baseUrl)}/ratings`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: chunk }),
        });
        if (!response.ok) return found;
        const data = (await response.json()) as RatingsResponse;
        for (const [id, row] of Object.entries(data.ratings ?? {})) {
          if (
            !row ||
            !Number.isFinite(row.rating) ||
            !Number.isFinite(row.votes)
          )
            continue;
          found.set(id.toLowerCase(), row);
        }
      }
      return found;
    } catch {
      return found;
    }
  }
}
