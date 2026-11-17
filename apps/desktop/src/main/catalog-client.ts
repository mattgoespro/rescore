import { libraryEntryFromDto } from "./catalog-mapping";
import { catalogFetch, systemResumes } from "./catalog-connection";
import { discoverHasAnotherPage, discoverQueryParams } from "./discover-slice";
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
  ForYouHints,
  ForYouResponse,
  LibraryEntryDto,
  TitleDto,
  TitleListResponse,
} from "../shared/catalog-dto";
import { genreId, movieFromTitle } from "../shared/movie";

type QueryValue = string | number | ReadonlyArray<string | number> | undefined;

export type RequestKind = "read" | "health" | "write" | "fill";

/**
 * The catalogue answers on the same machine, normally within milliseconds,
 * and calls reach it only once it is usable. The timeout is a guard against a
 * hung service, not an estimate of speed: a call that hits it is a bug to
 * report, and is not sent again. A dropped connection is retried, and so is a
 * timeout across a sleep of the computer: Windows timers keep counting while
 * it sleeps, so a call in flight then reaches its timeout on waking without
 * anything having hung. Reads, library writes and media fills are idempotent.
 */
const DEADLOCK_GUARD_MS = 30_000;

const REQUESTS: Record<RequestKind, { retries: number; timeoutMs: number }> = {
  read: { retries: 2, timeoutMs: DEADLOCK_GUARD_MS },
  // configured() probes an address the user typed, so it answers fast.
  health: { retries: 1, timeoutMs: 1000 },
  write: { retries: 2, timeoutMs: DEADLOCK_GUARD_MS },
  // A media fill waits on TMDb lookups for up to 40 titles.
  fill: { retries: 2, timeoutMs: 60_000 },
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
  private genreCache: Promise<Genre[]> | null = null;

  constructor(private readonly baseUrl: string) {}

  tmdbHealth(): Promise<{
    total: number;
    posters: number;
    synopses: number;
    certifications: number;
  }> {
    return this.request<{
      data: {
        total: number;
        posters: number;
        synopses: number;
        certifications: number;
      };
    }>("/v1/catalog/tmdb-health").then((body) => body.data);
  }

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
    query?: Record<string, QueryValue>,
    kind: RequestKind = "read",
    write?: { method: "POST" | "PUT" | "DELETE"; body?: unknown },
  ): Promise<T> {
    const url = new URL(
      path,
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      // A list repeats its parameter, so a value may hold commas.
      for (const item of Array.isArray(value) ? value : [value])
        if (item != null && item !== "")
          url.searchParams.append(key, String(item));
    }
    const { retries, timeoutMs } = REQUESTS[kind];
    let lastError: CatalogError | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      let response: Response;
      const resumesBefore = systemResumes();
      try {
        response = await catalogFetch(url, {
          method: write?.method ?? "GET",
          headers:
            write?.body === undefined
              ? { Accept: "application/json" }
              : {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
          body:
            write?.body === undefined ? undefined : JSON.stringify(write.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TimeoutError" &&
          systemResumes() === resumesBefore
        )
          throw new CatalogError(
            `The catalogue did not answer ${path} within ${timeoutMs / 1000} seconds.`,
            0,
          );
        lastError = new CatalogError(
          "Cannot reach the local catalogue API.",
          0,
        );
        if (attempt + 1 < retries) await sleep(400 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new CatalogError(
          body?.error ?? `Catalogue request failed (${response.status})`,
          response.status,
        );
      }
      return response.json() as Promise<T>;
    }
    throw (
      lastError ?? new CatalogError("Cannot reach the local catalogue API.", 0)
    );
  }

  async discover(filters: DiscoverFilters): Promise<PagedMovies> {
    const query = await this.discoverQuery(filters);
    const response = await this.request<TitleListResponse>("/v1/titles", query);
    const results = response.data.map(toSummary);
    const nextCursor = response.pagination.nextCursor ?? null;
    return {
      page: response.pagination.page,
      totalPages: response.pagination.totalPages,
      totalResults: response.pagination.total,
      results: results.map((movie) => ({ ...movie, match: 0, reasons: [] })),
      nextCursor,
      canLoadMore: discoverHasAnotherPage(results.length, nextCursor),
    };
  }

  async title(imdbId: string): Promise<MovieDetails> {
    const response = await this.request<{ data: TitleDto }>(
      `/v1/titles/${encodeURIComponent(imdbId)}`,
    );
    return toDetails(response.data);
  }

  /** Concurrent first callers share one request; a failed one is retried. */
  genres(): Promise<Genre[]> {
    this.genreCache ??= this.request<FacetsResponse>("/v1/facets").then(
      (response) =>
        response.genres.map((genre) => ({
          id: genreId(genre.value),
          name: genre.value,
        })),
      (error: unknown) => {
        this.genreCache = null;
        throw error;
      },
    );
    return this.genreCache;
  }

  async forYouPage(
    limit = 80,
    hints: ForYouHints = {},
  ): Promise<ForYouResponse> {
    return this.request<ForYouResponse>("/v1/for-you", {
      limit,
      genre: hints.genres,
      director: hints.directors,
      decade: hints.decades,
    });
  }

  private async genreNames(ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const genres = await this.genres();
    const wanted = new Set(ids);
    return genres
      .filter((genre) => wanted.has(genre.id))
      .map((genre) => genre.name);
  }

  async findByImdb(imdbId: string): Promise<MovieSummary | null> {
    try {
      return toSummary(
        (
          await this.request<{ data: TitleDto }>(
            `/v1/titles/${encodeURIComponent(imdbId)}`,
          )
        ).data,
      );
    } catch (error) {
      if (error instanceof CatalogError && error.status === 404) return null;
      throw error;
    }
  }

  async listLibrary(): Promise<LibraryEntry[]> {
    const response = await this.request<{ data: LibraryEntryDto[] }>(
      "/v1/library",
    );
    return response.data.map(libraryEntryFromDto);
  }

  async saveLibrary(
    movie: MovieSummary,
    status: WatchStatus,
    rating?: number,
    ratedAt?: string,
  ): Promise<void> {
    await this.request(
      `/v1/library/${encodeURIComponent(movie.imdbId)}`,
      undefined,
      "write",
      { method: "PUT", body: { status, personalRating: rating, ratedAt } },
    );
  }

  async clearLibrary(): Promise<LibraryEntry[]> {
    const body = await this.request<{ data: LibraryEntryDto[] }>(
      "/v1/library",
      undefined,
      "write",
      { method: "DELETE" },
    );
    return body.data.map(libraryEntryFromDto);
  }

  async removeLibrary(imdbId: string): Promise<void> {
    try {
      await this.request(
        `/v1/library/${encodeURIComponent(imdbId)}`,
        undefined,
        "write",
        { method: "DELETE" },
      );
    } catch (error) {
      // A retried delete finds the entry already gone.
      if (error instanceof CatalogError && error.status === 404) return;
      throw error;
    }
  }

  async fillMedia(ids: string[]): Promise<
    Array<{
      id: string;
      synopsis: string | null;
      posterUrl: string | null;
      certification: string | null;
      hydrationComplete: boolean;
    }>
  > {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))].slice(0, 40);
    if (!unique.length) return [];
    const body = await this.request<{
      data: Array<{
        id: string;
        synopsis: string | null;
        posterUrl: string | null;
        certification: string | null;
        hydrationComplete: boolean;
      }>;
    }>("/v1/catalog/fill", undefined, "fill", {
      method: "POST",
      body: { ids: unique },
    });
    return body.data;
  }

  private async discoverQuery(
    filters: DiscoverFilters,
  ): Promise<Record<string, string | number | undefined>> {
    const [genreNames, withoutGenreNames] = await Promise.all([
      this.genreNames(filters.genres),
      this.genreNames(filters.withoutGenres),
    ]);
    return discoverQueryParams(filters, {
      genres: genreNames,
      withoutGenres: withoutGenreNames,
    });
  }
}

function toSummary(title: TitleDto): MovieSummary {
  return movieFromTitle(title);
}

function toDetails(title: TitleDto): MovieDetails {
  const summary = toSummary(title);
  return {
    ...summary,
    genres: title.genres.map((name) => ({ id: genreId(name), name })),
    directors: title.directors.map((name) => ({ id: genreId(name), name })),
    cast: title.cast.map((name, order) => ({
      id: genreId(name),
      name,
      character: "",
      order,
      profilePath: null,
    })),
    keywords: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
