import type { FacetsResponse } from "../catalog-types.js";

const FACETS_TTL_MS = 10 * 60 * 1000;

let cached: { value: FacetsResponse; expires: number } | null = null;

export function readFacetsCache(): FacetsResponse | null {
  if (!cached || Date.now() > cached.expires) {
    cached = null;
    return null;
  }
  return cached.value;
}

export function writeFacetsCache(value: FacetsResponse): FacetsResponse {
  cached = { value, expires: Date.now() + FACETS_TTL_MS };
  return value;
}

export function invalidateFacetsCache(): void {
  cached = null;
}
