import { DEFAULT_CATALOG_API_URL } from "./settings";

let mediaProxyOrigin = DEFAULT_CATALOG_API_URL;

export function setMediaProxyOrigin(origin: string): void {
  mediaProxyOrigin = origin.trim().replace(/\/+$/, "");
}

export function posterUrl(
  path: string | null | undefined,
  size = "w342",
): string | null {
  if (!path) return null;
  const tmdb = path.match(
    /^https:\/\/(?:image|media)\.tmdb\.org\/t\/p\/[^/]+(\/.+)$/,
  );
  const remote = tmdb
    ? `https://image.tmdb.org/t/p/${size}${tmdb[1]}`
    : /^https?:\/\//i.test(path)
      ? path
      : path.startsWith("/")
        ? `https://image.tmdb.org/t/p/${size}${path}`
        : path;
  if (!remote) return null;
  if (mediaProxyOrigin && isTmdbImage(remote)) {
    return `${mediaProxyOrigin}/v1/media?src=${encodeURIComponent(remote)}`;
  }
  return remote;
}

function isTmdbImage(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "image.tmdb.org" ||
      host === "media.themoviedb.org" ||
      host === "www.themoviedb.org"
    );
  } catch {
    return false;
  }
}
