import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FacetsResponse,
  ImportStatusDto,
  LibraryEntryDto,
  LibraryStatus,
  TitleDto,
  TitleListResponse,
} from "../catalog-types.js";
import { bayesianScore } from "./bayesian.js";
import { invalidateFacetsCache } from "./facets-cache.js";
import {
  flagIsSet,
  readCatalogMeta,
  readiness,
  setFlag,
  writeCatalogMeta,
} from "./meta.js";
import { now } from "./now.js";
import {
  facets,
  invalidateCountCache,
  listForYouCandidates,
  listLibrary,
  listTitleIds,
  listTitles,
  titleById,
} from "./query.js";
import {
  clearRatingsStaging,
  finishCreditsRebuild,
  finishRebuild,
  insertPeople,
  insertRatingsStaging,
  insertTitleRows,
  lookupStagingRating,
  queueAnalyze,
  startCreditsRebuild,
  startRebuild,
  titleIdSet,
  upsertRatingsChunked,
  upsertRatingsSync,
} from "./rebuild.js";
import { applyMigrations } from "./schema.js";
import type {
  CatalogMeta,
  CatalogPersonRow,
  CatalogReadiness,
  CatalogTitleInput,
  CatalogTitleRow,
  LibraryRow,
  TitleQuery,
} from "./types.js";
import { catalogWorkQueue } from "./work-queue.js";

export class CatalogDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    applyMigrations(this.db);
  }

  upsertTitles(titles: CatalogTitleInput[]): number {
    const upsert = this.db.prepare(`INSERT INTO titles(id,title,original_title,kind,year,runtime_minutes,synopsis,poster_url,imdb_rating,imdb_votes,bayesian_score,updated_at)
      VALUES (@id,@title,@originalTitle,@kind,@year,@runtimeMinutes,@synopsis,@posterUrl,@imdbRating,@imdbVotes,@bayesianScore,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,original_title=excluded.original_title,kind=excluded.kind,year=excluded.year,runtime_minutes=excluded.runtime_minutes,synopsis=excluded.synopsis,poster_url=excluded.poster_url,updated_at=excluded.updated_at`);
    const clearGenres = this.db.prepare(
      "DELETE FROM title_genres WHERE title_id = ?",
    );
    const addGenre = this.db.prepare(
      "INSERT OR IGNORE INTO title_genres(title_id, genre) VALUES (?, ?)",
    );
    const clearPeople = this.db.prepare(
      "DELETE FROM title_people WHERE title_id = ?",
    );
    const addPerson = this.db.prepare(
      "INSERT OR IGNORE INTO title_people(title_id, name, role, position) VALUES (?, ?, ?, ?)",
    );
    this.db.transaction((items: CatalogTitleInput[]) => {
      for (const input of items) {
        upsert.run({
          ...input,
          originalTitle: input.originalTitle ?? null,
          kind: input.kind ?? "movie",
          year: input.year ?? null,
          runtimeMinutes: input.runtimeMinutes ?? null,
          synopsis: input.synopsis ?? null,
          posterUrl: input.posterUrl ?? null,
          imdbRating: null,
          imdbVotes: null,
          bayesianScore: bayesianScore(null, null),
          updatedAt: now(),
        });
        clearGenres.run(input.id);
        for (const genre of input.genres ?? []) addGenre.run(input.id, genre);
        clearPeople.run(input.id);
        for (const [position, name] of (input.directors ?? []).entries()) {
          addPerson.run(input.id, name, "director", position);
        }
        for (const [position, name] of (input.cast ?? []).entries()) {
          addPerson.run(input.id, name, "cast", position);
        }
      }
    })(titles);
    invalidateFacetsCache();
    invalidateCountCache();
    return titles.length;
  }

  upsertRatings(ratings: Map<string, { rating: number; votes: number }>): number {
    if (ratings.size <= 5_000) return upsertRatingsSync(this.db, ratings);
    void upsertRatingsChunked(this.db, ratings);
    return ratings.size;
  }

  upsertRatingsChunked(
    ratings: Map<string, { rating: number; votes: number }>,
  ): Promise<number> {
    return upsertRatingsChunked(this.db, ratings);
  }

  ratings(
    ids: string[],
  ): Record<string, { rating: number; votes: number } | null> {
    const select = this.db.prepare(
      "SELECT imdb_rating, imdb_votes FROM titles WHERE id = ?",
    );
    return Object.fromEntries(
      ids.map((id) => {
        const row = select.get(id.toLowerCase()) as
          | { imdb_rating: number | null; imdb_votes: number | null }
          | undefined;
        return [
          id,
          row?.imdb_rating == null || row.imdb_votes == null
            ? null
            : { rating: row.imdb_rating, votes: row.imdb_votes },
        ];
      }),
    );
  }

  listTitles(query: TitleQuery): TitleListResponse {
    return listTitles(this.db, query);
  }

  listTitleIds(query: TitleQuery): string[] {
    return listTitleIds(this.db, query);
  }

  title(id: string): TitleDto | null {
    return titleById(this.db, id);
  }

  titleNeedsMedia(id: string): boolean {
    const row = this.db
      .prepare(
        "SELECT poster_url, synopsis FROM titles WHERE id = ?",
      )
      .get(id.toLowerCase()) as
      | { poster_url: string | null; synopsis: string | null }
      | undefined;
    return Boolean(row && (row.poster_url == null || row.synopsis == null));
  }

  facets(): FacetsResponse {
    return facets(this.db);
  }

  listLibrary(status?: LibraryStatus): LibraryEntryDto[] {
    return listLibrary(this.db, status);
  }

  listForYouCandidates(limit: number): TitleDto[] {
    return listForYouCandidates(this.db, limit);
  }

  saveLibrary(
    id: string,
    status: LibraryStatus,
    personalRating: number | null,
    note: string | null,
  ): LibraryEntryDto | null {
    if (!this.title(id)) return null;
    this.db
      .prepare(
        `INSERT INTO library_entries(title_id,status,personal_rating,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(title_id) DO UPDATE SET status=excluded.status,personal_rating=excluded.personal_rating,note=excluded.note,updated_at=excluded.updated_at`,
      )
      .run(id.toLowerCase(), status, personalRating, note, now());
    return (
      this.listLibrary().find((entry) => entry.title.id === id.toLowerCase()) ??
      null
    );
  }

  deleteLibrary(id: string): boolean {
    return (
      this.db
        .prepare("DELETE FROM library_entries WHERE title_id = ?")
        .run(id.toLowerCase()).changes > 0
    );
  }

  createImport(id: string, kind: ImportStatusDto["kind"]): void {
    this.db
      .prepare("INSERT INTO imports(id,kind,status,started_at) VALUES(?,?,'running',?)")
      .run(id, kind, now());
  }

  finishImport(
    id: string,
    status: ImportStatusDto["status"],
    importedTitles: number,
    message: string | null = null,
  ): void {
    this.db
      .prepare(
        "UPDATE imports SET status=?,finished_at=?,imported_titles=?,message=? WHERE id=?",
      )
      .run(status, now(), importedTitles, message, id);
  }

  importStatus(id: string): ImportStatusDto | null {
    const row = this.db.prepare("SELECT * FROM imports WHERE id = ?").get(id) as
      | {
          id: string;
          kind: ImportStatusDto["kind"];
          status: ImportStatusDto["status"];
          started_at: string;
          finished_at: string | null;
          imported_titles: number;
          message: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          kind: row.kind,
          status: row.status,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          importedTitles: row.imported_titles,
          message: row.message,
        }
      : null;
  }

  titleCount(): number {
    return (
      this.db.prepare("SELECT count(*) AS count FROM titles").get() as {
        count: number;
      }
    ).count;
  }

  posterStats(): {
    total: number;
    pending: number;
    found: number;
    missing: number;
  } {
    return this.db
      .prepare(
        `SELECT
      count(*) AS total,
      sum(CASE WHEN poster_url IS NULL THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN poster_url IS NOT NULL AND poster_url != '' THEN 1 ELSE 0 END) AS found,
      sum(CASE WHEN poster_url = '' THEN 1 ELSE 0 END) AS missing
    FROM titles`,
      )
      .get() as {
      total: number;
      pending: number;
      found: number;
      missing: number;
    };
  }

  listTitlesNeedingPosters(
    limit = 400,
    priorityIds: string[] = [],
  ): Array<{ id: string; kind: string }> {
    const needsEnrichment =
      "(poster_url IS NULL OR synopsis IS NULL)";
    const wanted = [
      ...new Set(priorityIds.map((id) => id.toLowerCase()).filter(Boolean)),
    ];
    const prioritized = wanted.length
      ? (this.db
          .prepare(
            `SELECT id, kind FROM titles WHERE ${needsEnrichment} AND id IN (${wanted.map(() => "?").join(",")})`,
          )
          .all(...wanted) as Array<{ id: string; kind: string }>)
      : [];
    if (prioritized.length >= limit) return prioritized.slice(0, limit);
    const exclude = new Set(prioritized.map((row) => row.id));
    const rest = this.db
      .prepare(
        `SELECT id, kind FROM titles WHERE ${needsEnrichment} ORDER BY imdb_votes DESC, id LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; kind: string }>;
    for (const row of rest) {
      if (exclude.has(row.id)) continue;
      prioritized.push(row);
      if (prioritized.length >= limit) break;
    }
    return prioritized;
  }

  snapshotPosterUrls(): Array<{
    id: string;
    posterUrl: string | null;
    synopsis: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT id, poster_url AS posterUrl, synopsis
         FROM titles
         WHERE poster_url IS NOT NULL OR synopsis IS NOT NULL`,
      )
      .all() as Array<{
      id: string;
      posterUrl: string | null;
      synopsis: string | null;
    }>;
  }

  updatePosterUrls(
    rows: Array<{
      id: string;
      posterUrl?: string | null;
      synopsis?: string | null;
    }>,
  ): void {
    if (!rows.length) return;
    const update = this.db.prepare(
      `UPDATE titles SET
        poster_url = CASE WHEN poster_url IS NULL THEN @posterUrl ELSE poster_url END,
        synopsis = CASE WHEN synopsis IS NULL THEN @synopsis ELSE synopsis END
       WHERE id = @id`,
    );
    this.db.transaction(() => {
      for (const row of rows) {
        update.run({
          id: row.id,
          posterUrl: row.posterUrl ?? "",
          synopsis: row.synopsis ?? "",
        });
      }
    })();
  }

  updatePosterUrlsQueued(
    rows: Array<{
      id: string;
      posterUrl?: string | null;
      synopsis?: string | null;
    }>,
  ): Promise<void> {
    return catalogWorkQueue.enqueue(() => this.updatePosterUrls(rows));
  }

  catalogMeta(): CatalogMeta {
    return readCatalogMeta(this.db);
  }

  setCatalogMeta(meta: { builtAt: string; revision: string; source: string }): void {
    writeCatalogMeta(this.db, meta);
  }

  setBuildInProgress(running: boolean): void {
    setFlag(this.db, "buildInProgress", running);
  }

  isBuildInProgress(): boolean {
    return flagIsSet(this.db, "buildInProgress");
  }

  setCreditsInProgress(running: boolean): void {
    setFlag(this.db, "creditsInProgress", running);
  }

  isCreditsInProgress(): boolean {
    return flagIsSet(this.db, "creditsInProgress");
  }

  setCreditsReady(ready: boolean): void {
    setFlag(this.db, "creditsReady", ready);
  }

  readiness(): CatalogReadiness {
    return readiness(this.db);
  }

  titlesReady(): boolean {
    return this.readiness().titlesReady;
  }

  creditsReady(): boolean {
    return this.readiness().creditsReady;
  }

  snapshotLibrary(): LibraryRow[] {
    return this.db
      .prepare(
        "SELECT title_id, status, personal_rating, note, updated_at FROM library_entries",
      )
      .all() as LibraryRow[];
  }

  startRebuild(): void {
    startRebuild(this.db);
  }

  startCreditsRebuild(): void {
    startCreditsRebuild(this.db);
  }

  insertTitleRows(rows: CatalogTitleRow[]): void {
    insertTitleRows(this.db, rows);
  }

  insertPeople(rows: CatalogPersonRow[]): void {
    insertPeople(this.db, rows);
  }

  finishRebuild(library: LibraryRow[]): void {
    finishRebuild(this.db, library);
  }

  finishCreditsRebuild(): void {
    finishCreditsRebuild(this.db);
  }

  queueAnalyze(target?: string): Promise<void> {
    return queueAnalyze(this.db, target);
  }

  clearRatingsStaging(): void {
    clearRatingsStaging(this.db);
  }

  insertRatingsStaging(
    rows: Array<{ id: string; rating: number; votes: number }>,
  ): void {
    insertRatingsStaging(this.db, rows);
  }

  lookupStagingRating(
    id: string,
  ): { rating: number; votes: number } | undefined {
    return lookupStagingRating(this.db, id);
  }

  titleIdSet(): Set<string> {
    return titleIdSet(this.db);
  }

  close(): void {
    this.db.close();
  }

  isHealthy(): boolean {
    try {
      this.db.prepare("SELECT 1 FROM titles LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }
}
