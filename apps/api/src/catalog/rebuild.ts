import type Database from "better-sqlite3";
import { imdbValue, readTsvRows } from "../services/gzip-tsv.js";
import { bayesianScore } from "./bayesian.js";
import { invalidateFacetsCache } from "./facets-cache.js";
import { now } from "./now.js";
import { invalidateCountCache } from "./query.js";
import {
  dropFtsTriggers,
  rebuildFtsIndex,
  restoreFtsTriggers,
} from "./schema.js";
import type { CatalogPersonRow, CatalogTitleRow } from "./types.js";
import {
  catalogWorkQueue,
  queueIdleAnalyze,
  yieldEventLoop,
} from "./work-queue.js";

const RATING_CHUNK = 5_000;
const TITLE_VALUE_CHUNK = 50;
const PERSON_VALUE_CHUNK = 80;
const IMDB_ID = /^tt\d+$/i;

const UPDATE_RATING_SQL = `UPDATE titles
  SET imdb_rating = ?, imdb_votes = ?, bayesian_score = ?, updated_at = ?
  WHERE id = ? AND (imdb_rating IS NOT ? OR imdb_votes IS NOT ?)`;

export function beginBulkLoad(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  dropFtsTriggers(db);
}

export function endBulkLoad(db: Database.Database): void {
  rebuildFtsIndex(db);
  restoreFtsTriggers(db);
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  invalidateFacetsCache();
  invalidateCountCache();
}

export function startCreditsRebuild(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = OFF");
}

export function insertTitleRows(
  db: Database.Database,
  rows: CatalogTitleRow[],
): void {
  if (!rows.length) return;
  const addGenre = db.prepare(
    "INSERT OR IGNORE INTO title_genres(title_id, genre) VALUES (?, ?)",
  );
  const updatedAt = now();
  const statements = new Map<number, Database.Statement>();
  db.transaction(() => {
    for (let index = 0; index < rows.length; index += TITLE_VALUE_CHUNK) {
      const chunk = rows.slice(index, index + TITLE_VALUE_CHUNK);
      let statement = statements.get(chunk.length);
      if (!statement) {
        const placeholders = chunk
          .map(() => "(?,?,?,?,?,?,NULL,NULL,?,?,?,?)")
          .join(",");
        statement = db.prepare(
          `INSERT INTO titles(id,title,original_title,kind,year,runtime_minutes,synopsis,poster_url,imdb_rating,imdb_votes,bayesian_score,updated_at) VALUES ${placeholders}`,
        );
        statements.set(chunk.length, statement);
      }
      const values: Array<string | number | null> = [];
      for (const row of chunk) {
        values.push(
          row.id,
          row.title,
          row.originalTitle,
          row.kind,
          row.year,
          row.runtimeMinutes,
          row.imdbRating,
          row.imdbVotes,
          bayesianScore(row.imdbRating, row.imdbVotes),
          updatedAt,
        );
      }
      statement.run(...values);
      for (const row of chunk) {
        for (const genre of row.genres) addGenre.run(row.id, genre);
      }
    }
  })();
  invalidateCountCache();
}

export function insertPeople(
  db: Database.Database,
  rows: CatalogPersonRow[],
): void {
  if (!rows.length) return;
  const upsertPerson = db.prepare(
    "INSERT INTO people(nconst, name) VALUES (?, ?) ON CONFLICT(nconst) DO UPDATE SET name=excluded.name",
  );
  const statements = new Map<number, Database.Statement>();
  db.transaction(() => {
    for (const row of rows) upsertPerson.run(row.nconst, row.name);
    for (let index = 0; index < rows.length; index += PERSON_VALUE_CHUNK) {
      const chunk = rows.slice(index, index + PERSON_VALUE_CHUNK);
      let statement = statements.get(chunk.length);
      if (!statement) {
        const placeholders = chunk.map(() => "(?,?,?,?)").join(",");
        statement = db.prepare(
          `INSERT OR IGNORE INTO title_people(title_id, nconst, role, position) VALUES ${placeholders}`,
        );
        statements.set(chunk.length, statement);
      }
      const values: Array<string | number> = [];
      for (const row of chunk) {
        values.push(row.titleId, row.nconst, row.role, row.position);
      }
      statement.run(...values);
    }
  })();
  invalidateCountCache();
}

export function existingPeopleNames(
  db: Database.Database,
  nconsts: Iterable<string>,
): Map<string, string> {
  const ids = [...nconsts];
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const chunkSize = 400;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const rows = db
      .prepare(
        `SELECT nconst, name FROM people WHERE nconst IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as Array<{ nconst: string; name: string }>;
    for (const row of rows) names.set(row.nconst, row.name);
  }
  return names;
}

export function creditSignatures(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare(
      "SELECT title_id, nconst, role, position FROM title_people ORDER BY title_id, role, position",
    )
    .all() as Array<{
    title_id: string;
    nconst: string;
    role: string;
    position: number;
  }>;
  const signatures = new Map<string, string[]>();
  for (const row of rows) {
    const list = signatures.get(row.title_id) ?? [];
    list.push(`${row.role}:${row.nconst}`);
    signatures.set(row.title_id, list);
  }
  return new Map(
    [...signatures].map(([id, parts]) => [id, parts.join("|")]),
  );
}

export function replaceTitleCredits(
  db: Database.Database,
  titleId: string,
  rows: CatalogPersonRow[],
): void {
  db.prepare("DELETE FROM title_people WHERE title_id = ?").run(titleId);
  if (rows.length) insertPeople(db, rows);
}

const UPSERT_TITLE_SQL = `INSERT INTO titles(id,title,original_title,kind,year,runtime_minutes,synopsis,poster_url,imdb_rating,imdb_votes,bayesian_score,updated_at)
VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  original_title=excluded.original_title,
  kind=excluded.kind,
  year=excluded.year,
  runtime_minutes=excluded.runtime_minutes,
  imdb_rating=excluded.imdb_rating,
  imdb_votes=excluded.imdb_votes,
  bayesian_score=excluded.bayesian_score,
  updated_at=excluded.updated_at
WHERE titles.title IS NOT excluded.title
  OR titles.original_title IS NOT excluded.original_title
  OR titles.kind IS NOT excluded.kind
  OR titles.year IS NOT excluded.year
  OR titles.runtime_minutes IS NOT excluded.runtime_minutes
  OR titles.imdb_rating IS NOT excluded.imdb_rating
  OR titles.imdb_votes IS NOT excluded.imdb_votes`;

export function startTitleIngest(db: Database.Database, bulk: boolean): void {
  if (bulk) beginBulkLoad(db);
  db.exec("CREATE TEMP TABLE IF NOT EXISTS ingest_seen (id TEXT PRIMARY KEY)");
  db.exec("DELETE FROM ingest_seen");
}

export function abortTitleIngest(db: Database.Database, bulk: boolean): void {
  db.exec("DROP TABLE IF EXISTS ingest_seen");
  if (bulk) endBulkLoad(db);
}

export function finishTitleIngest(db: Database.Database, bulk: boolean): void {
  db.exec("DELETE FROM titles WHERE id NOT IN (SELECT id FROM ingest_seen)");
  db.exec("DROP TABLE IF EXISTS ingest_seen");
  if (bulk) {
    endBulkLoad(db);
    return;
  }
  invalidateFacetsCache();
  invalidateCountCache();
}

export function upsertTitleRows(
  db: Database.Database,
  rows: CatalogTitleRow[],
  bulk: boolean,
): void {
  if (!rows.length) return;
  if (bulk) {
    insertTitleRows(db, rows);
    const mark = db.prepare("INSERT OR IGNORE INTO ingest_seen(id) VALUES (?)");
    db.transaction(() => {
      for (const row of rows) mark.run(row.id);
    })();
    return;
  }
  const upsert = db.prepare(UPSERT_TITLE_SQL);
  const mark = db.prepare("INSERT OR IGNORE INTO ingest_seen(id) VALUES (?)");
  const addGenre = db.prepare(
    "INSERT OR IGNORE INTO title_genres(title_id, genre) VALUES (?, ?)",
  );
  const clearGenres = db.prepare("DELETE FROM title_genres WHERE title_id = ?");
  const updatedAt = now();
  db.transaction(() => {
    for (const row of rows) mark.run(row.id);
    const placeholders = rows.map(() => "?").join(",");
    const genreRows = db
      .prepare(
        `SELECT title_id, genre FROM title_genres WHERE title_id IN (${placeholders}) ORDER BY genre`,
      )
      .all(...rows.map((row) => row.id)) as Array<{
      title_id: string;
      genre: string;
    }>;
    const current = new Map<string, string[]>();
    for (const row of genreRows) {
      const list = current.get(row.title_id) ?? [];
      list.push(row.genre);
      current.set(row.title_id, list);
    }
    for (const row of rows) {
      upsert.run(
        row.id,
        row.title,
        row.originalTitle,
        row.kind,
        row.year,
        row.runtimeMinutes,
        row.imdbRating,
        row.imdbVotes,
        bayesianScore(row.imdbRating, row.imdbVotes),
        updatedAt,
      );
      const next = [...row.genres].sort();
      const prev = current.get(row.id) ?? [];
      if (prev.join("\0") !== next.join("\0")) {
        clearGenres.run(row.id);
        for (const genre of row.genres) addGenre.run(row.id, genre);
      }
    }
  })();
  invalidateCountCache();
}

export function finishCreditsRebuild(db: Database.Database): void {
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  invalidateFacetsCache();
  invalidateCountCache();
}

export function queueAnalyze(
  db: Database.Database,
  target?: string,
): Promise<void> {
  return queueIdleAnalyze(() => {
    db.exec(target ? `ANALYZE ${target}` : "ANALYZE");
  });
}

export function titleIdSet(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT id FROM titles").all() as Array<{
    id: string;
  }>;
  return new Set(rows.map((row) => row.id));
}

function applyRatingUpdates(
  db: Database.Database,
  ratings: Iterable<[string, { rating: number; votes: number }]>,
): number {
  const statement = db.prepare(UPDATE_RATING_SQL);
  const updatedAt = now();
  let count = 0;
  db.transaction(() => {
    for (const [id, rating] of ratings) {
      count += statement.run(
        rating.rating,
        rating.votes,
        bayesianScore(rating.rating, rating.votes),
        updatedAt,
        id.toLowerCase(),
        rating.rating,
        rating.votes,
      ).changes;
    }
  })();
  return count;
}

export async function upsertRatingsChunked(
  db: Database.Database,
  ratings: Map<string, { rating: number; votes: number }>,
): Promise<number> {
  return catalogWorkQueue.enqueue(async () => {
    const kept = titleIdSet(db);
    let batch: Array<[string, { rating: number; votes: number }]> = [];
    let updated = 0;
    const flush = (): void => {
      if (!batch.length) return;
      updated += applyRatingUpdates(db, batch);
      batch = [];
    };
    for (const [id, rating] of ratings) {
      const key = id.toLowerCase();
      if (!kept.has(key)) continue;
      batch.push([key, rating]);
      if (batch.length >= RATING_CHUNK) {
        flush();
        await yieldEventLoop();
      }
    }
    flush();
    invalidateFacetsCache();
    invalidateCountCache();
    return updated;
  });
}

export async function upsertRatingsFromFile(
  db: Database.Database,
  file: string,
): Promise<number> {
  return catalogWorkQueue.enqueue(async () => {
    const kept = titleIdSet(db);
    let batch: Array<[string, { rating: number; votes: number }]> = [];
    let updated = 0;
    const flush = (): void => {
      if (!batch.length) return;
      updated += applyRatingUpdates(db, batch);
      batch = [];
    };
    for await (const [tconst, averageRating, numVotes] of readTsvRows(file)) {
      const id = imdbValue(tconst)?.toLowerCase();
      if (!id || !IMDB_ID.test(id) || !kept.has(id)) continue;
      const rating = Number(averageRating);
      const votes = Number(numVotes);
      if (!Number.isFinite(rating) || !Number.isFinite(votes)) continue;
      batch.push([id, { rating, votes }]);
      if (batch.length >= RATING_CHUNK) {
        flush();
        await yieldEventLoop();
      }
    }
    flush();
    invalidateFacetsCache();
    invalidateCountCache();
    return updated;
  });
}

export function upsertRatingsSync(
  db: Database.Database,
  ratings: Map<string, { rating: number; votes: number }>,
): number {
  const updated = applyRatingUpdates(db, ratings);
  invalidateFacetsCache();
  invalidateCountCache();
  return updated;
}
