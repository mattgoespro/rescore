import type {
  DiscoverFilters,
  Genre,
  LibraryEntry,
  MovieDetails,
  MovieSummary,
  PagedMovies,
  WatchStatus,
} from "../shared/types";
import type {
  FacetsResponse,
  ForYouResponse,
  LibraryEntryDto,
  TitleDto,
  TitleListResponse,
} from "../shared/catalog-dto";

export type RequestKind = "search" | "health" | "long";

const REQUESTS: Record<RequestKind, { retries: number; timeoutMs: number }> = {
  search: { retries: 2, timeoutMs: 4000 },
  health: { retries: 1, timeoutMs: 1000 },
  long: { retries: 4, timeoutMs: 20000 },
};

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class CatalogClient {
  private genreCache: Genre[] | null = null;

  constructor(private readonly baseUrl: string) {}

  async configured(): Promise<boolean> {
    if (!this.baseUrl.trim()) return false;
    try {
      const health = await this.request<{ ready?: boolean }>(
        "/health",
        undefined,
        "health",
      );
      return Boolean(health.ready);
    } catch {
      return false;
    }
  }

  private async request<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    kind: RequestKind = "search",
  ): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    const { retries, timeoutMs } = REQUESTS[kind];
    let lastError: CatalogError | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        lastError = new CatalogError("Cannot reach the local catalog API.", 0);
        if (attempt + 1 < retries) await sleep(400 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new CatalogError(body?.error ?? `Catalog request failed (${response.status})`, response.status);
      }
      return response.json() as Promise<T>;
    }
    throw lastError ?? new CatalogError("Cannot reach the local catalog API.", 0);
  }

  async discover(filters: DiscoverFilters): Promise<PagedMovies> {
    const query = await this.discoverQuery(filters);
    const response = await this.request<TitleListResponse>("/v1/titles", {
      ...query,
      includeTotal: filters.page > 1 ? "false" : "true",
    });
    const results = response.data.map(toSummary);
    return {
      page: response.pagination.page,
      totalPages: response.pagination.totalPages,
      totalResults: response.pagination.total,
      results: results.map((movie) => ({ ...movie, match: 0, reasons: [] })),
    };
  }

  async title(imdbId: string): Promise<MovieDetails> {
    const response = await this.request<{ data: TitleDto }>(`/v1/titles/${encodeURIComponent(imdbId)}`);
    return toDetails(response.data);
  }

  async genres(): Promise<Genre[]> {
    if (this.genreCache) return this.genreCache;
    const response = await this.request<FacetsResponse>("/v1/facets");
    this.genreCache = response.genres.map((genre) => ({
      id: genreId(genre.value),
      name: genre.value,
    }));
    return this.genreCache;
  }

  async forYouPage(limit = 250): Promise<ForYouResponse> {
    return this.request<ForYouResponse>("/v1/for-you", { limit });
  }

  private async genreNames(ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const genres = await this.genres();
    const wanted = new Set(ids);
    return genres.filter((genre) => wanted.has(genre.id)).map((genre) => genre.name);
  }

  async findByImdb(imdbId: string): Promise<MovieSummary | null> {
    try {
      return toSummary((await this.request<{ data: TitleDto }>(`/v1/titles/${encodeURIComponent(imdbId)}`)).data);
    } catch (error) {
      if (error instanceof CatalogError && error.status === 404) return null;
      throw error;
    }
  }

  async listLibrary(): Promise<LibraryEntry[]> {
    const response = await this.request<{ data: LibraryEntryDto[] }>("/v1/library");
    return response.data.map(({ title, status, personalRating, updatedAt }) =>
      toLibraryEntry(title, status, personalRating ?? undefined, updatedAt),
    );
  }

  async saveLibrary(movie: MovieSummary, status: WatchStatus, rating?: number): Promise<void> {
    const url = new URL(`/v1/library/${encodeURIComponent(movie.imdbId)}`, this.baseUrl);
    const response = await fetch(url, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ status, personalRating: rating ?? null }),
      signal: AbortSignal.timeout(REQUESTS.search.timeoutMs),
    });
    if (!response.ok) throw new CatalogError(`Could not save library entry (${response.status})`, response.status);
  }

  async removeLibrary(imdbId: string): Promise<void> {
    const response = await fetch(new URL(`/v1/library/${encodeURIComponent(imdbId)}`, this.baseUrl), {
      method: "DELETE",
      signal: AbortSignal.timeout(REQUESTS.search.timeoutMs),
    });
    if (!response.ok && response.status !== 404) throw new CatalogError(`Could not remove library entry (${response.status})`, response.status);
  }

  async enrichPosters(
    ids: string[],
    filters?: DiscoverFilters,
    extraPages = 0,
  ): Promise<void> {
    if (!ids.length && extraPages <= 0) return;
    const query = filters ? await this.discoverQuery(filters) : {};
    const url = new URL("/v1/catalog/enrich-posters", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        ids,
        extraPages: extraPages || undefined,
        ...query,
        hideWatched: query.hideWatched === "true",
        hideWatchlist: query.hideWatchlist === "true",
      }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined);
  }

  private async discoverQuery(
    filters: DiscoverFilters,
  ): Promise<Record<string, string | number | undefined>> {
    const genreNames = await this.genreNames(filters.genres);
    return {
      page: filters.page,
      pageSize: 40,
      limit: 40,
      query: filters.query || undefined,
      kind: filters.titleKind === "miniseries" ? "miniseries" : filters.titleKind,
      yearMin: filters.yearMin ?? undefined,
      yearMax: filters.yearMax ?? undefined,
      ratingMin: filters.ratingMin || undefined,
      votesMin: filters.voteCountMin || undefined,
      runtimeMin: filters.runtimeMin ?? undefined,
      runtimeMax: filters.runtimeMax ?? undefined,
      genre: genreNames.length ? genreNames.join(",") : undefined,
      hideWatched: filters.hideWatched ? "true" : undefined,
      hideWatchlist: filters.hideWatchlist ? "true" : undefined,
      sort: sortFor(filters.sortBy),
      order: orderFor(filters.sortBy),
    };
  }
}

export function genreId(name: string): number {
  return [...name.toLowerCase()].reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 7);
}

function toSummary(title: TitleDto): MovieSummary {
  const kind = title.kind.toLowerCase();
  const titleKind = kind.includes("mini") ? "miniseries" : kind.includes("tv") || kind.includes("series") ? "tv" : "movie";
  return {
    imdbId: title.id.toLowerCase(), mediaType: titleKind === "movie" ? "movie" : "tv", titleKind,
    title: title.title, originalTitle: title.originalTitle ?? undefined, overview: title.synopsis ?? "",
    posterPath: title.posterUrl, backdropPath: null, releaseDate: title.year ? `${title.year}-01-01` : "",
    year: title.year ?? undefined, genreIds: title.genres.map(genreId), originalLanguage: "", popularity: 0,
    voteAverage: title.imdbRating ?? 0, voteCount: title.imdbVotes ?? 0, adult: false,
    runtime: title.runtimeMinutes ?? undefined, directorIds: title.directors.map(genreId),
    directorNames: title.directors, castIds: title.cast.map(genreId), castNames: title.cast,
  };
}

function toDetails(title: TitleDto): MovieDetails {
  const summary = toSummary(title);
  return {
    ...summary, genres: title.genres.map((name) => ({ id: genreId(name), name })),
    directors: title.directors.map((name) => ({ id: genreId(name), name })),
    cast: title.cast.map((name, order) => ({ id: genreId(name), name, character: "", order, profilePath: null })),
    keywords: [],
  };
}

function toLibraryEntry(title: TitleDto, status: WatchStatus, rating: number | undefined, updatedAt: string): LibraryEntry {
  const movie = toSummary(title);
  return { ...movie, status, rating, updatedAt, directorIds: movie.directorIds ?? [], directorNames: movie.directorNames ?? [], castIds: movie.castIds ?? [], castNames: movie.castNames ?? [] };
}

function sortFor(sort: string): string {
  if (sort.includes("vote_average")) return "rating";
  if (sort.includes("vote_count") || sort.includes("popularity")) return "votes";
  if (sort.includes("release_date")) return "year";
  return sort === "match" ? "votes" : "title";
}

function orderFor(sort: string): string {
  return sort.includes(".asc") ? "asc" : sort === "title" ? "asc" : "desc";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
