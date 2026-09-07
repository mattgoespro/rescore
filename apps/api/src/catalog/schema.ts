import type Database from "better-sqlite3";
import { BAYESIAN_PRIOR_VOTES } from "./bayesian.js";
import { now } from "./now.js";

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
];

export function applyMigrations(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (
      db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version)
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
