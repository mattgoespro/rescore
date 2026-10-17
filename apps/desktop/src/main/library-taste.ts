import { CatalogError, type CatalogClient } from "./catalog-client";
import { libraryEntryFromDto } from "./catalog-mapping";
import { loadDiscoverSlice } from "./discover-slice";
import { createTasteCache, withLibraryWrite } from "./taste-cache";
import {
  buildProfile,
  describeProfile,
  publicProfile,
  scoreMovie,
  tasteRanked,
} from "./ranking";
import { genreId, movieFromTitle } from "../shared/movie";
import {
  sortMovies,
  titleKey,
  type DiscoverFilters,
  type ImportProgress,
  type LibraryEntry,
  type MovieSummary,
  type MovieEnrichment,
  type RankingMode,
  type RankedMovie,
  type WatchStatus,
} from "../shared/types";
import type { ImdbCsvRow } from "./csv";

export type LibraryCatalogue = Pick<
  CatalogClient,
  | "listLibrary"
  | "genres"
  | "saveLibrary"
  | "removeLibrary"
  | "clearLibrary"
  | "findByImdb"
  | "discover"
  | "forYouPage"
>;
export interface LibraryUpsert {
  movie: MovieSummary;
  status: WatchStatus;
  rating?: number;
  ratedAt?: string;
}

export function createLibraryTasteWorkflow<
  C extends LibraryCatalogue,
>(options: {
  connection(): { identity: string; url: string };
  createClient(url: string): C;
  rankingMode(): RankingMode;
}) {
  type Connection = { identity: string; client: C };
  let active: Connection | null = null;
  const taste = createTasteCache<{
    library: LibraryEntry[];
    genres: { id: number; name: string }[];
  }>();
  function connection(): Connection {
    const next = options.connection();
    if (!active || active.identity !== next.identity) {
      taste.drop();
      active = {
        identity: next.identity,
        client: options.createClient(next.url),
      };
    }
    return active;
  }
  function check(captured: Connection): void {
    if (connection() !== captured)
      throw new Error(
        "Catalogue changed while the operation was in progress. Try again.",
      );
  }
  async function run<T>(
    work: (client: C, captured: Connection) => Promise<T>,
  ): Promise<T> {
    const captured = connection();
    const result = await work(captured.client, captured);
    check(captured);
    return result;
  }
  async function readOrEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
    try {
      return await load();
    } catch (error) {
      if (error instanceof CatalogError && error.status === 0) {
        console.warn(error.message);
        return [];
      }
      throw error;
    }
  }
  const list = () => run((client) => client.listLibrary());
  const upsert = (payload: LibraryUpsert) =>
    withLibraryWrite(taste, () =>
      run(async (client) => {
        await client.saveLibrary(
          payload.movie,
          payload.status,
          payload.rating,
          payload.ratedAt,
        );
        return client.listLibrary();
      }),
    );
  const remove = (id: string) =>
    withLibraryWrite(taste, () =>
      run(async (client) => {
        await client.removeLibrary(id);
        return client.listLibrary();
      }),
    );
  const clear = () =>
    withLibraryWrite(taste, () =>
      run(async (client) => {
        await client.clearLibrary();
        return [] as LibraryEntry[];
      }),
    );
  const discover = (filters: DiscoverFilters) =>
    run(async (client, captured) => {
      let library: LibraryEntry[] = [],
        genres: { id: number; name: string }[] = [];
      if (filters.sortBy === "match") {
        ({ library, genres } = await taste.read(async () => {
          const [library, genres] = await Promise.all([
            client.listLibrary(),
            client.genres(),
          ]);
          check(captured);
          return { library, genres };
        }));
        check(captured);
      }
      const profile = buildProfile(library, genres);
      const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
      return loadDiscoverSlice({
        filters,
        mode: filters.cursor == null ? "replace" : "append",
        cursor: filters.cursor ?? null,
        ratedCount: profile.ratedCount,
        fetchPage: (page) => client.discover(page),
        rankPage: (movies) =>
          sortMovies(
            movies.map((movie) =>
              scoreMovie(movie, profile, options.rankingMode(), entries),
            ),
            "match",
          ),
      });
    });
  const forYou = () =>
    run(async (client) => {
      const payload = await client.forYouPage(80);
      const library = payload.library.map(libraryEntryFromDto);
      const genres = payload.facets.genres.map((genre) => ({
        id: genreId(genre.value),
        name: genre.value,
      }));
      const profile = buildProfile(library, genres);
      const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
      const movies = tasteRanked<RankedMovie>(
        profile.ratedCount,
        payload.candidates.map((title) => ({
          ...movieFromTitle(title),
          match: 0,
          reasons: [],
        })),
        (rows) =>
          sortMovies(
            rows.map((movie) =>
              scoreMovie(movie, profile, options.rankingMode(), entries),
            ),
            "match",
          ),
      ).slice(0, 40);
      return {
        profile: publicProfile(profile),
        insights: describeProfile(profile),
        movies,
      };
    });
  const profile = () =>
    run(async (client) => {
      const [library, genres] = await Promise.all([
        readOrEmpty(() => client.listLibrary()),
        readOrEmpty(() => client.genres()),
      ]);
      return publicProfile(buildProfile(library, genres));
    });
  const enrich = (
    movies: MovieSummary[],
  ): Promise<Record<string, MovieEnrichment>> =>
    run(async (client) => {
      const [library, genres] = await Promise.all([
        client.listLibrary(),
        client.genres(),
      ]);
      const profile = buildProfile(library, genres);
      const entries = new Map(library.map((entry) => [titleKey(entry), entry]));
      return Object.fromEntries(
        movies.map((movie) => {
          const ranked = scoreMovie(
            movie,
            profile,
            options.rankingMode(),
            entries,
          );
          return [
            titleKey(movie),
            { match: ranked.match, reasons: ranked.reasons },
          ];
        }),
      );
    });
  const importRatings = (
    rows: ImdbCsvRow[],
    report: (progress: ImportProgress) => void = () => {},
  ) =>
    run(async (client, captured) => {
      const progress: ImportProgress = {
        current: 0,
        total: rows.length,
        title: "",
        imported: 0,
        skipped: 0,
        errors: 0,
        done: false,
      };
      for (const [index, row] of rows.entries()) {
        check(captured);
        progress.current = index + 1;
        progress.title = row.title;
        report({ ...progress });
        try {
          const movie = await client.findByImdb(row.imdbId);
          check(captured);
          if (!movie) progress.skipped++;
          else {
            await withLibraryWrite(taste, () =>
              client.saveLibrary(movie, "watched", row.rating, row.dateRated),
            );
            progress.imported++;
          }
        } catch {
          check(captured);
          progress.errors++;
        }
      }
      progress.done = true;
      progress.title = "Import complete";
      report({ ...progress });
      return progress;
    });
  return {
    client: () => connection().client,
    list,
    upsert,
    remove,
    clear,
    discover,
    forYou,
    profile,
    enrich,
    importRatings,
    invalidate: () => taste.drop(),
  };
}
