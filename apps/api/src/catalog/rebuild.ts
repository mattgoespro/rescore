import type Database from "better-sqlite3";
import { bayesianScore } from "./bayesian.js";
import { invalidateFacetsCache } from "./facets-cache.js";
import { now } from "./now.js";
import { invalidateCountCache } from "./query.js";
import type { CatalogPersonRow, CatalogTitleRow, LibraryRow } from "./types.js";
import { catalogWorkQueue, yieldEventLoop } from "./work-queue.js";

const RATING_CHUNK = 5_000;

export function startRebuild(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = OFF");
  db.exec("DELETE FROM title_people; DELETE FROM title_genres; DELETE FROM titles;");
  invalidateFacetsCache();
  invalidateCountCache();
}

export function startCreditsRebuild(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = OFF");
  db.exec("DELETE FROM title_people;");
  invalidateFacetsCache();
  invalidateCountCache();
}

export function insertTitleRows(
  db: Database.Database,
  rows: CatalogTitleRow[],
): void {
  if (!rows.length) return;
  const insert = db.prepare(`INSERT INTO titles(id,title,original_title,kind,year,runtime_minutes,synopsis,poster_url,imdb_rating,imdb_votes,bayesian_score,updated_at)
      VALUES (@id,@title,@originalTitle,@kind,@year,@runtimeMinutes,NULL,NULL,@imdbRating,@imdbVotes,@bayesianScore,@updatedAt)`);
  const addGenre = db.prepare(
    "INSERT OR IGNORE INTO title_genres(title_id, genre) VALUES (?, ?)",
  );
  const updatedAt = now();
  db.transaction(() => {
    for (const row of rows) {
      insert.run({
        ...row,
        bayesianScore: bayesianScore(row.imdbRating, row.imdbVotes),
        updatedAt,
      });
      for (const genre of row.genres) addGenre.run(row.id, genre);
    }
  })();
  invalidateCountCache();
}

export function insertPeople(
  db: Database.Database,
  rows: CatalogPersonRow[],
): void {
  if (!rows.length) return;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO title_people(title_id, name, role, position) VALUES (@titleId, @name, @role, @position)",
  );
  db.transaction(() => {
    for (const row of rows) insert.run(row);
  })();
  invalidateCountCache();
}

export function finishRebuild(
  db: Database.Database,
  library: LibraryRow[],
): void {
  const restore = db.prepare(`INSERT INTO library_entries(title_id,status,personal_rating,note,updated_at)
      VALUES (@title_id,@status,@personal_rating,@note,@updated_at)`);
  const exists = db.prepare("SELECT 1 FROM titles WHERE id = ?");
  db.exec("DELETE FROM library_entries");
  db.transaction(() => {
    for (const entry of library) {
      if (exists.get(entry.title_id)) restore.run(entry);
    }
  })();
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  invalidateFacetsCache();
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
  return catalogWorkQueue.enqueue(() => {
    db.exec(target ? `ANALYZE ${target}` : "ANALYZE");
  });
}

export function clearRatingsStaging(db: Database.Database): void {
  db.exec("DELETE FROM ratings_staging");
}

export function insertRatingsStaging(
  db: Database.Database,
  rows: Array<{ id: string; rating: number; votes: number }>,
): void {
  if (!rows.length) return;
  const insert = db.prepare(
    "INSERT OR REPLACE INTO ratings_staging(id, rating, votes) VALUES (@id, @rating, @votes)",
  );
  db.transaction(() => {
    for (const row of rows) insert.run(row);
  })();
}

export function lookupStagingRating(
  db: Database.Database,
  id: string,
): { rating: number; votes: number } | undefined {
  return db
    .prepare("SELECT rating, votes FROM ratings_staging WHERE id = ?")
    .get(id) as { rating: number; votes: number } | undefined;
}

export function titleIdSet(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT id FROM titles").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

export async function upsertRatingsChunked(
  db: Database.Database,
  ratings: Map<string, { rating: number; votes: number }>,
): Promise<number> {
  return catalogWorkQueue.enqueue(async () => {
    clearRatingsStaging(db);
    let batch: Array<{ id: string; rating: number; votes: number }> = [];
    const flush = (): void => {
      insertRatingsStaging(db, batch);
      batch = [];
    };
    for (const [id, rating] of ratings) {
      batch.push({
        id: id.toLowerCase(),
        rating: rating.rating,
        votes: rating.votes,
      });
      if (batch.length >= RATING_CHUNK) {
        flush();
        await yieldEventLoop();
      }
    }
    flush();

    const ids = db
      .prepare(
        "SELECT t.id FROM titles t JOIN ratings_staging r ON r.id = t.id",
      )
      .all() as Array<{ id: string }>;
    const update = db.prepare(
      `UPDATE titles SET imdb_rating = ?, imdb_votes = ?, bayesian_score = ?, updated_at = ? WHERE id = ?`,
    );
    const lookup = db.prepare(
      "SELECT rating, votes FROM ratings_staging WHERE id = ?",
    );
    const updatedAt = now();
    let updated = 0;
    for (let index = 0; index < ids.length; index += RATING_CHUNK) {
      const chunk = ids.slice(index, index + RATING_CHUNK);
      db.transaction(() => {
        for (const { id } of chunk) {
          const row = lookup.get(id) as
            | { rating: number; votes: number }
            | undefined;
          if (!row) continue;
          updated += update.run(
            row.rating,
            row.votes,
            bayesianScore(row.rating, row.votes),
            updatedAt,
            id,
          ).changes;
        }
      })();
      await yieldEventLoop();
    }
    clearRatingsStaging(db);
    invalidateFacetsCache();
    invalidateCountCache();
    return updated;
  });
}

export function upsertRatingsSync(
  db: Database.Database,
  ratings: Map<string, { rating: number; votes: number }>,
): number {
  const statement = db.prepare(
    "UPDATE titles SET imdb_rating = ?, imdb_votes = ?, bayesian_score = ?, updated_at = ? WHERE id = ?",
  );
  const updatedAt = now();
  const updated = db.transaction(() => {
    let count = 0;
    for (const [id, rating] of ratings) {
      count += statement.run(
        rating.rating,
        rating.votes,
        bayesianScore(rating.rating, rating.votes),
        updatedAt,
        id.toLowerCase(),
      ).changes;
    }
    return count;
  })();
  invalidateFacetsCache();
  invalidateCountCache();
  return updated;
}
