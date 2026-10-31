import { CatalogError, type CatalogClient } from "./catalog-client";
import { loadDiscoverSlice } from "./discover-slice";
import { createTasteCache, withLibraryWrite } from "./taste-cache";
import {
  buildProfile,
  describeProfile,
  forYouHints,
  publicProfile,
  scoreMovie,
  tasteRanked,
} from "./ranking";
import { movieFromTitle } from "../shared/movie";
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
/** CSV rows imported at once. */
const IMPORT_CONCURRENCY = 6;

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
  // The profile and entry index are built once per library state, not on
  // every Discover page or match lookup.
  const taste = createTasteCache<{
    library: LibraryEntry[];
    profile: ReturnType<typeof buildProfile>;
    entries: Map<string, LibraryEntry>;
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
  /** The library and genres taste reads, shared until the next library write. */
  function tasteInputs(client: C, captured: Connection) {
    return taste.read(async () => {
      const [library, genres] = await Promise.all([
        client.listLibrary(),
        client.genres(),
      ]);
      check(captured);
      return {
        library,
        profile: buildProfile(library, genres),
        entries: new Map(library.map((entry) => [titleKey(entry), entry])),
      };
    });
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
      let profile = buildProfile([], []);
      let entries = new Map<string, LibraryEntry>();
      if (filters.sortBy === "match") {
        ({ profile, entries } = await tasteInputs(client, captured));
        check(captured);
      }
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
    run(async (client, captured) => {
      // The shared taste inputs drop on every library write, so the profile
      // that picks the hints also ranks what they bring back.
      const { profile, entries } = await tasteInputs(client, captured);
      const payload = await client.forYouPage(80, forYouHints(profile));
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
    run(async (client, captured) => {
      try {
        const { profile } = await tasteInputs(client, captured);
        return publicProfile(profile);
      } catch (error) {
        // An unreachable catalogue reads as an empty profile, not an error.
        if (error instanceof CatalogError && error.status === 0) {
          console.warn(error.message);
          return publicProfile(buildProfile([], []));
        }
        throw error;
      }
    });
  const enrich = (
    movies: MovieSummary[],
  ): Promise<Record<string, MovieEnrichment>> =>
    run(async (client, captured) => {
      const { profile, entries } = await tasteInputs(client, captured);
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
      // A few rows at a time: each is a lookup and a save, and one after
      // another a large export waits on thousands of round trips.
      let next = 0;
      const importRow = async (row: ImdbCsvRow): Promise<void> => {
        try {
          const movie = await client.findByImdb(row.imdbId);
          check(captured);
          if (!movie) progress.skipped++;
          else {
            await client.saveLibrary(
              movie,
              "watched",
              row.rating,
              row.dateRated,
            );
            progress.imported++;
          }
        } catch {
          check(captured);
          progress.errors++;
        }
        progress.current++;
        progress.title = row.title;
        report({ ...progress });
      };
      const worker = async (): Promise<void> => {
        while (next < rows.length) {
          check(captured);
          await importRow(rows[next++]!);
        }
      };
      await withLibraryWrite(taste, () =>
        Promise.all(
          Array.from(
            { length: Math.min(IMPORT_CONCURRENCY, rows.length) },
            worker,
          ),
        ),
      );
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
