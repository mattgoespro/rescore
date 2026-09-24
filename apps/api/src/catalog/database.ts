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
  getMetaValue,
  readCatalogMeta,
  readiness,
  setFlag,
  setMetaValue,
  writeCatalogMeta,
} from "./meta.js";
import { now } from "./now.js";
import {
  facets,
  invalidateCountCache,
  listForYouCandidates,
  listLibrary,
  listTitles,
  titleById,
} from "./query.js";
import {
  abortTitleIngest,
  beginBulkLoad,
  endBulkLoad,
  finishCreditsRebuild,
  finishTitleIngest,
  insertPeople,
  insertTitleRows,
  queueAnalyze,
  startCreditsRebuild,
  startTitleIngest,
  titleIdSet,
  creditSignatures,
  existingPeopleNames,
  replaceTitleCredits,
  upsertRatingsChunked,
  upsertRatingsFromFile,
  upsertRatingsSync,
  upsertTitleRows,
} from "./rebuild.js";
import { applyMigrations } from "./schema.js";
import {
  personKey,
  type CatalogMeta,
  type CatalogPersonRow,
  type CatalogReadiness,
  type CatalogTitleInput,
  type CatalogTitleRow,
  type TitleQuery,
} from "./types.js";
import { mediaWorkQueue } from "./work-queue.js";

export class CatalogDatabase {
  private readonly db: Database.Database;
  private ingestBulk = false;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 15000");
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
    const upsertPerson = this.db.prepare(
      "INSERT INTO people(nconst, name) VALUES (?, ?) ON CONFLICT(nconst) DO UPDATE SET name=excluded.name",
    );
    const addPerson = this.db.prepare(
      "INSERT OR IGNORE INTO title_people(title_id, nconst, role, position) VALUES (?, ?, ?, ?)",
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
          const nconst = personKey(name);
          upsertPerson.run(nconst, name);
          addPerson.run(input.id, nconst, "director", position);
        }
        for (const [position, name] of (input.cast ?? []).entries()) {
          const nconst = personKey(name);
          upsertPerson.run(nconst, name);
          addPerson.run(input.id, nconst, "cast", position);
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

  mediaFor(ids: string[]): Array<{
    id: string;
    kind: string;
    posterUrl: string | null;
    synopsis: string | null;
    certification: string | null;
  }> {
    const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].filter(Boolean);
    if (!wanted.length) return [];
    const placeholders = wanted.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT id, kind, poster_url AS posterUrl, synopsis, certification
         FROM titles WHERE id IN (${placeholders})`,
      )
      .all(...wanted) as Array<{
      id: string;
      kind: string;
      posterUrl: string | null;
      synopsis: string | null;
      certification: string | null;
    }>;
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
    this.bumpLibrarySkipRev();
    return (
      this.listLibrary().find((entry) => entry.title.id === id.toLowerCase()) ??
      null
    );
  }

  deleteLibrary(id: string): boolean {
    const changed =
      this.db
        .prepare("DELETE FROM library_entries WHERE title_id = ?")
        .run(id.toLowerCase()).changes > 0;
    if (changed) this.bumpLibrarySkipRev();
    return changed;
  }

  private bumpLibrarySkipRev(): void {
    const next = Number(getMetaValue(this.db, "librarySkipRev") ?? "0") + 1;
    setMetaValue(this.db, "librarySkipRev", String(next));
    invalidateCountCache();
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
    fillRest = false,
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
    if (!fillRest || prioritized.length >= limit) return prioritized.slice(0, limit);
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

  updatePosterUrls(
    rows: Array<{
      id: string;
      posterUrl?: string | null;
      synopsis?: string | null;
      certification?: string | null;
    }>,
  ): void {
    if (!rows.length) return;
    const update = this.db.prepare(
      `UPDATE titles SET
        poster_url = CASE WHEN poster_url IS NULL THEN @posterUrl ELSE poster_url END,
        synopsis = CASE WHEN synopsis IS NULL THEN @synopsis ELSE synopsis END,
        certification = CASE WHEN certification IS NULL THEN @certification ELSE certification END
       WHERE id = @id`,
    );
    this.db.transaction(() => {
      for (const row of rows) {
        update.run({
          id: row.id,
          posterUrl: row.posterUrl ?? "",
          synopsis: row.synopsis ?? "",
          certification: row.certification ?? null,
        });
      }
    })();
  }

  updatePosterUrlsQueued(
    rows: Array<{
      id: string;
      posterUrl?: string | null;
      synopsis?: string | null;
      certification?: string | null;
    }>,
  ): Promise<void> {
    return mediaWorkQueue.enqueue(() => this.updatePosterUrls(rows));
  }

  upsertRatingsFromFile(file: string): Promise<number> {
    return upsertRatingsFromFile(this.db, file);
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

  beginBulkLoad(): void {
    beginBulkLoad(this.db);
  }

  endBulkLoad(): void {
    endBulkLoad(this.db);
  }

  startCreditsRebuild(): void {
    startCreditsRebuild(this.db);
  }

  insertTitleRows(rows: CatalogTitleRow[]): void {
    insertTitleRows(this.db, rows);
  }

  upsertTitleRows(rows: CatalogTitleRow[]): void {
    upsertTitleRows(this.db, rows, this.ingestBulk);
  }

  startTitleIngest(): void {
    this.ingestBulk = this.titleCount() === 0;
    startTitleIngest(this.db, this.ingestBulk);
  }

  finishTitleIngest(): void {
    finishTitleIngest(this.db, this.ingestBulk);
    this.ingestBulk = false;
  }

  abortTitleIngest(): void {
    abortTitleIngest(this.db, this.ingestBulk);
    this.ingestBulk = false;
  }

  titleRowid(id: string): number | null {
    const row = this.db
      .prepare("SELECT rowid AS rowid FROM titles WHERE id = ?")
      .get(id.toLowerCase()) as { rowid: number } | undefined;
    return row?.rowid ?? null;
  }

  titleDumpFingerprint(): string | null {
    return getMetaValue(this.db, "titlesDumpFingerprint");
  }

  setTitleDumpFingerprint(value: string): void {
    setMetaValue(this.db, "titlesDumpFingerprint", value);
  }

  creditsDumpFingerprint(): string | null {
    return getMetaValue(this.db, "creditsDumpFingerprint");
  }

  setCreditsDumpFingerprint(value: string): void {
    setMetaValue(this.db, "creditsDumpFingerprint", value);
  }

  setTitlesUpdateAvailable(ready: boolean): void {
    setFlag(this.db, "titlesUpdateAvailable", ready);
  }

  titlesUpdateAvailable(): boolean {
    return flagIsSet(this.db, "titlesUpdateAvailable");
  }

  insertPeople(rows: CatalogPersonRow[]): void {
    insertPeople(this.db, rows);
  }

  peopleNames(nconsts: Iterable<string>): Map<string, string> {
    return existingPeopleNames(this.db, nconsts);
  }

  creditSignatures(): Map<string, string> {
    return creditSignatures(this.db);
  }

  replaceTitleCredits(titleId: string, rows: CatalogPersonRow[]): void {
    replaceTitleCredits(this.db, titleId, rows);
  }

  finishCreditsRebuild(): void {
    finishCreditsRebuild(this.db);
  }

  queueAnalyze(target?: string): Promise<void> {
    return queueAnalyze(this.db, target);
  }

  titleIdSet(): Set<string> {
    return titleIdSet(this.db);
  }

  ftsShadowRowCount(): number {
    return (
      this.db.prepare("SELECT count(*) AS n FROM titles_fts_data").get() as {
        n: number;
      }
    ).n;
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
