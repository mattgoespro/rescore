import type Database from "better-sqlite3";
import { BAYESIAN_PRIOR_VOTES } from "./bayesian.js";
import { now } from "./now.js";

export const TMDB_HYDRATION_PENDING_SQL =
  "poster_url IS NULL OR synopsis IS NULL OR certification IS NULL OR COALESCE(languages_checked, 0) != 1";

/**
 * `titles.genre_mask` mirrors `title_genres` as one bit per genre so genre
 * filters test an indexed integer instead of probing `title_genres` for every
 * title the sort walks. Bits are assigned once, in first-seen order, up to 53
 * so a mask stays exact as a JS number; a genre past that has no bit and its
 * filters keep the `EXISTS` form.
 */
export const GENRE_BIT_LIMIT = 53;

const ASSIGN_GENRE_BITS_SQL = `INSERT INTO genre_bits(genre, bit)
   SELECT genre, (SELECT count(*) FROM genre_bits) + row_number() OVER (ORDER BY genre) - 1
   FROM (SELECT DISTINCT genre FROM title_genres WHERE genre NOT IN (SELECT genre FROM genre_bits))
   LIMIT max(0, ${GENRE_BIT_LIMIT} - (SELECT count(*) FROM genre_bits));`;

const REBUILD_GENRE_MASKS_SQL = `UPDATE titles SET genre_mask = m.mask
   FROM (SELECT g.title_id, sum(1 << b.bit) AS mask
         FROM title_genres g JOIN genre_bits b ON b.genre = g.genre
         GROUP BY g.title_id) AS m
   WHERE titles.id = m.title_id AND titles.genre_mask IS NOT m.mask;
   UPDATE titles SET genre_mask = 0
   WHERE genre_mask != 0 AND NOT EXISTS (
     SELECT 1 FROM title_genres g JOIN genre_bits b ON b.genre = g.genre
     WHERE g.title_id = titles.id);`;

export const GENRE_MASK_INSERT_TRIGGER = `CREATE TRIGGER IF NOT EXISTS title_genres_mask_ai AFTER INSERT ON title_genres BEGIN
    INSERT OR IGNORE INTO genre_bits(genre, bit)
      SELECT new.genre, count(*) FROM genre_bits HAVING count(*) < ${GENRE_BIT_LIMIT};
    UPDATE titles SET genre_mask = genre_mask | (1 << (SELECT bit FROM genre_bits WHERE genre = new.genre))
      WHERE id = new.title_id AND EXISTS (SELECT 1 FROM genre_bits WHERE genre = new.genre);
   END;`;

export const GENRE_MASK_DELETE_TRIGGER = `CREATE TRIGGER IF NOT EXISTS title_genres_mask_ad AFTER DELETE ON title_genres BEGIN
    UPDATE titles SET genre_mask = genre_mask & ~(1 << (SELECT bit FROM genre_bits WHERE genre = old.genre))
      WHERE id = old.title_id AND EXISTS (SELECT 1 FROM genre_bits WHERE genre = old.genre);
   END;`;

export const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS titles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, kind TEXT NOT NULL DEFAULT 'movie',
    year INTEGER, runtime_minutes INTEGER, synopsis TEXT, poster_url TEXT,
    imdb_rating REAL, imdb_votes INTEGER, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS title_genres (title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE, genre TEXT NOT NULL, PRIMARY KEY(title_id, genre));
   CREATE TABLE IF NOT EXISTS title_people (title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('director','cast')), position INTEGER NOT NULL, PRIMARY KEY(title_id, name, role));
   CREATE TABLE IF NOT EXISTS library_entries (
    title_id TEXT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('watched','watchlist','skipped')),
    personal_rating REAL, note TEXT, updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    imported_titles INTEGER NOT NULL DEFAULT 0, message TEXT
   );
   CREATE INDEX IF NOT EXISTS titles_sort_idx ON titles(kind, year, imdb_rating, imdb_votes);
   CREATE INDEX IF NOT EXISTS title_genres_genre_idx ON title_genres(genre);`,
  `CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS titles_title_idx ON titles(title COLLATE NOCASE);
   CREATE INDEX IF NOT EXISTS titles_votes_idx ON titles(kind, imdb_votes);
   CREATE INDEX IF NOT EXISTS titles_runtime_idx ON titles(kind, runtime_minutes);`,
  `CREATE INDEX IF NOT EXISTS titles_poster_pending_idx ON titles(imdb_votes DESC, id) WHERE poster_url IS NULL;`,
  `ALTER TABLE titles ADD COLUMN bayesian_score REAL;
   UPDATE titles SET bayesian_score = (CAST(COALESCE(imdb_votes, 0) AS REAL) / (COALESCE(imdb_votes, 0) + ${BAYESIAN_PRIOR_VOTES})) * COALESCE(imdb_rating, 0);
   CREATE INDEX IF NOT EXISTS titles_bayesian_idx ON titles(kind, bayesian_score DESC);
   CREATE TABLE IF NOT EXISTS ratings_staging (
    id TEXT PRIMARY KEY,
    rating REAL NOT NULL,
    votes INTEGER NOT NULL
   );`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(
    title,
    original_title,
    id,
    content='titles',
    content_rowid='rowid'
  );
   CREATE TRIGGER IF NOT EXISTS titles_fts_ai AFTER INSERT ON titles BEGIN
    INSERT INTO titles_fts(rowid, title, original_title, id)
    VALUES (new.rowid, new.title, new.original_title, new.id);
   END;
   CREATE TRIGGER IF NOT EXISTS titles_fts_ad AFTER DELETE ON titles BEGIN
    INSERT INTO titles_fts(titles_fts, rowid, title, original_title, id)
    VALUES ('delete', old.rowid, old.title, old.original_title, old.id);
   END;
   CREATE TRIGGER IF NOT EXISTS titles_fts_au AFTER UPDATE ON titles BEGIN
    INSERT INTO titles_fts(titles_fts, rowid, title, original_title, id)
    VALUES ('delete', old.rowid, old.title, old.original_title, old.id);
    INSERT INTO titles_fts(rowid, title, original_title, id)
    VALUES (new.rowid, new.title, new.original_title, new.id);
   END;
   INSERT INTO titles_fts(rowid, title, original_title, id)
   SELECT rowid, title, original_title, id FROM titles;`,
  `CREATE INDEX IF NOT EXISTS titles_enrich_pending_idx
     ON titles(imdb_votes DESC, id)
     WHERE poster_url IS NULL OR synopsis IS NULL;`,
  `DROP TRIGGER IF EXISTS titles_fts_au;
   CREATE TRIGGER titles_fts_au AFTER UPDATE ON titles
   WHEN old.title IS NOT new.title
     OR old.original_title IS NOT new.original_title
     OR old.id IS NOT new.id
   BEGIN
    INSERT INTO titles_fts(titles_fts, rowid, title, original_title, id)
    VALUES ('delete', old.rowid, old.title, old.original_title, old.id);
    INSERT INTO titles_fts(rowid, title, original_title, id)
    VALUES (new.rowid, new.title, new.original_title, new.id);
   END;`,
  `CREATE TABLE IF NOT EXISTS people (
      nconst TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    DROP TABLE IF EXISTS title_people;
    CREATE TABLE title_people (
      title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      nconst TEXT NOT NULL REFERENCES people(nconst),
      role TEXT NOT NULL CHECK(role IN ('director','cast')),
      position INTEGER NOT NULL,
      PRIMARY KEY(title_id, nconst, role)
    );
    CREATE INDEX IF NOT EXISTS title_people_nconst_idx ON title_people(nconst);
    DELETE FROM catalog_meta WHERE key = 'creditsReady';`,
  `CREATE INDEX IF NOT EXISTS titles_kind_votes_desc_idx ON titles(kind, imdb_votes DESC);`,
  `ALTER TABLE titles ADD COLUMN certification TEXT;`,
  `CREATE INDEX IF NOT EXISTS people_name_idx ON people(name)`,
  `DROP INDEX IF EXISTS titles_enrich_pending_idx;
   CREATE INDEX IF NOT EXISTS titles_tmdb_pending_idx
     ON titles(imdb_votes DESC, id)
     WHERE poster_url IS NULL OR synopsis IS NULL OR certification IS NULL;`,
  `CREATE TABLE IF NOT EXISTS title_languages (
      title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (title_id, language)
    );
    ALTER TABLE titles ADD COLUMN languages_checked INTEGER NOT NULL DEFAULT 0;`,
  `DROP INDEX IF EXISTS titles_tmdb_pending_idx;
   CREATE INDEX IF NOT EXISTS titles_tmdb_pending_idx
     ON titles(imdb_votes DESC, id)
     WHERE ${TMDB_HYDRATION_PENDING_SQL};`,
  `ALTER TABLE titles ADD COLUMN tmdb_checked_at INTEGER;
   CREATE INDEX titles_tmdb_retry_idx
     ON titles(COALESCE(tmdb_checked_at, 0), imdb_votes DESC, id)
     WHERE poster_url = '' OR synopsis = '';`,
  `ALTER TABLE library_entries ADD COLUMN rated_at TEXT;`,
  // Discover's rating and year sorts walk these in result order; the trailing
  // columns let the vote, rating, and year floors filter without a row lookup.
  `CREATE INDEX IF NOT EXISTS titles_kind_rating_idx
     ON titles(kind, imdb_rating DESC, imdb_votes DESC, year);
   CREATE INDEX IF NOT EXISTS titles_kind_year_idx
     ON titles(kind, year DESC, imdb_votes, imdb_rating);`,
  // The votes index widens to carry Discover's floors and genre mask, so sparse
  // filters skip titles without a row lookup. For You ranks every kind by
  // votes, which the kind-led index could only gather and sort.
  `ALTER TABLE titles ADD COLUMN genre_mask INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE IF NOT EXISTS genre_bits (genre TEXT PRIMARY KEY, bit INTEGER NOT NULL UNIQUE);
   ${ASSIGN_GENRE_BITS_SQL}
   ${REBUILD_GENRE_MASKS_SQL}
   ${GENRE_MASK_INSERT_TRIGGER}
   ${GENRE_MASK_DELETE_TRIGGER}
   DROP INDEX IF EXISTS titles_kind_votes_desc_idx;
   CREATE INDEX IF NOT EXISTS titles_kind_votes_cover_idx
     ON titles(kind, imdb_votes DESC, year, imdb_rating, genre_mask);
   CREATE INDEX IF NOT EXISTS titles_votes_desc_idx ON titles(imdb_votes DESC, id);`,
];

export const FTS_INSERT_TRIGGER = `CREATE TRIGGER IF NOT EXISTS titles_fts_ai AFTER INSERT ON titles BEGIN
    INSERT INTO titles_fts(rowid, title, original_title, id)
    VALUES (new.rowid, new.title, new.original_title, new.id);
   END;`;

export const FTS_DELETE_TRIGGER = `CREATE TRIGGER IF NOT EXISTS titles_fts_ad AFTER DELETE ON titles BEGIN
    INSERT INTO titles_fts(titles_fts, rowid, title, original_title, id)
    VALUES ('delete', old.rowid, old.title, old.original_title, old.id);
   END;`;

export const FTS_UPDATE_TRIGGER = `CREATE TRIGGER IF NOT EXISTS titles_fts_au AFTER UPDATE ON titles
   WHEN old.title IS NOT new.title
     OR old.original_title IS NOT new.original_title
     OR old.id IS NOT new.id
   BEGIN
    INSERT INTO titles_fts(titles_fts, rowid, title, original_title, id)
    VALUES ('delete', old.rowid, old.title, old.original_title, old.id);
    INSERT INTO titles_fts(rowid, title, original_title, id)
    VALUES (new.rowid, new.title, new.original_title, new.id);
   END;`;

export function dropFtsTriggers(db: Database.Database): void {
  db.exec(
    "DROP TRIGGER IF EXISTS titles_fts_ai; DROP TRIGGER IF EXISTS titles_fts_ad; DROP TRIGGER IF EXISTS titles_fts_au;",
  );
}

export function restoreFtsTriggers(db: Database.Database): void {
  db.exec(
    `${FTS_INSERT_TRIGGER}; ${FTS_DELETE_TRIGGER}; ${FTS_UPDATE_TRIGGER}`,
  );
}

export function dropGenreMaskTriggers(db: Database.Database): void {
  db.exec(
    "DROP TRIGGER IF EXISTS title_genres_mask_ai; DROP TRIGGER IF EXISTS title_genres_mask_ad;",
  );
}

export function restoreGenreMaskTriggers(db: Database.Database): void {
  db.exec(`${GENRE_MASK_INSERT_TRIGGER}; ${GENRE_MASK_DELETE_TRIGGER}`);
}

export function rebuildGenreMasks(db: Database.Database): void {
  db.exec(`${ASSIGN_GENRE_BITS_SQL} ${REBUILD_GENRE_MASKS_SQL}`);
}

export function rebuildFtsIndex(db: Database.Database): void {
  db.exec("INSERT INTO titles_fts(titles_fts) VALUES('delete-all')");
  db.exec(
    "INSERT INTO titles_fts(rowid, title, original_title, id) SELECT rowid, title, original_title, id FROM titles",
  );
}

export function applyMigrations(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (
      db
        .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get(version)
    ) {
      return;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      ).run(version, now());
    })();
  });
}
