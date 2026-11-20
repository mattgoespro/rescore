import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { CatalogDatabase } from "./database.js";
import {
  facets,
  listForYouCandidates,
  listLibrary,
  LANGUAGE_SET_THRESHOLD,
  listTitles,
} from "./query.js";
import { applyMigrations, TMDB_HYDRATION_PENDING_SQL } from "./schema.js";
import type { TitleQuery } from "./types.js";

// The catalogue holds about half a million titles, so a plan that reads the
// whole titles table, or sorts every match before its LIMIT, costs tens to
// hundreds of milliseconds. These tests pin the plans of the hot queries:
// when one fails, measure the new query on a real catalogue (EXPLAIN QUERY
// PLAN and timings) before changing the expectation.

function catalogue(): Database.Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  const insert = db.prepare(
    "INSERT INTO titles(id, title, kind, year, imdb_rating, imdb_votes, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01')",
  );
  for (const [index, kind] of ["movie", "tv", "miniseries"].entries())
    insert.run(`tt${index + 1}`, `Title ${index}`, kind, 1990 + index, 7, 9000);
  db.prepare(
    "INSERT INTO title_genres(title_id, genre) VALUES ('tt1', 'Drama')",
  ).run();
  return db;
}

/** Runs `work` and returns the plan of every statement it ran on titles. */
function plans(
  db: Database.Database,
  work: () => void,
): Array<{ sql: string; plan: string }> {
  const seen: Array<{ sql: string; plan: string }> = [];
  const prepare = db.prepare.bind(db);
  const spy = (sql: string) => {
    const statement = prepare(sql);
    if (!/\btitles\b/.test(sql)) return statement;
    for (const method of ["all", "get"] as const) {
      const run = statement[method].bind(statement) as (
        ...args: unknown[]
      ) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (
        ...args: unknown[]
      ) => {
        const plan = (
          prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{
            detail: string;
          }>
        )
          .map((row) => row.detail)
          .join(" | ");
        seen.push({ sql: sql.replace(/\s+/g, " "), plan });
        return run(...args);
      };
    }
    return statement;
  };
  (db as unknown as { prepare: typeof spy }).prepare = spy;
  try {
    work();
  } finally {
    (db as unknown as { prepare: typeof prepare }).prepare = prepare;
  }
  return seen;
}

/** A full read of the titles table, as opposed to an index range or seek. */
const FULL_TABLE_SCAN = /\bSCAN (t|titles)\b(?! USING)/;

const page: Omit<TitleQuery, "sort"> = {
  page: 1,
  pageSize: 40,
  order: "desc",
  includeTotal: false,
};

test("Discover pages never read the whole titles table", () => {
  const db = catalogue();
  const searches: TitleQuery[] = [
    { ...page, sort: "votes", kind: "movie" },
    { ...page, sort: "rating", kind: "movie", genres: ["Drama"] },
    { ...page, sort: "year", kind: "movie", ratingMin: 7 },
    { ...page, sort: "votes", kind: "movie", query: "title" },
    {
      ...page,
      sort: "votes",
      kind: "movie",
      hideMissingPoster: true,
      hideMissingSynopsis: true,
    },
    { ...page, sort: "title" },
  ];
  for (const search of searches) {
    for (const { sql, plan } of plans(db, () => listTitles(db, search)))
      assert.doesNotMatch(plan, FULL_TABLE_SCAN, `${sql}\n=> ${plan}`);
  }
  db.close();
});

test("a kind filter walks the index that matches the sort", () => {
  const db = catalogue();
  const [first] = plans(db, () =>
    listTitles(db, { ...page, sort: "votes", kind: "movie" }),
  );
  assert.match(first!.plan, /titles_kind_votes_cover_idx \(kind=\?\)/);
  db.close();
});

test("an original-language filter reads a sparse language's titles and walks the sort index for a dense one", () => {
  const db = catalogue();
  const position0 = db.prepare(
    "INSERT INTO title_languages(title_id, language, position) VALUES (?, ?, 0)",
  );
  const title = db.prepare(
    "INSERT INTO titles(id, title, kind, year, imdb_rating, imdb_votes, updated_at) VALUES (?, 'English', 'movie', 2000, 6, 5000, '2026-01-01')",
  );
  db.transaction(() => {
    position0.run("tt1", "is");
    for (let index = 0; index <= LANGUAGE_SET_THRESHOLD; index++) {
      title.run(`tt${index + 10}`);
      position0.run(`tt${index + 10}`, "en");
    }
  })();
  const search = { ...page, sort: "rating", kind: "movie" } as const;
  const [sparse] = plans(db, () =>
    listTitles(db, { ...search, languages: ["is"] }),
  );
  assert.match(sparse!.plan, /title_languages_original_idx \(language=\?\)/);
  assert.doesNotMatch(sparse!.plan, /titles_kind_rating_idx/);
  assert.doesNotMatch(sparse!.plan, FULL_TABLE_SCAN);
  const [dense] = plans(db, () =>
    listTitles(db, { ...search, languages: ["en"] }),
  );
  assert.match(dense!.plan, /titles_kind_rating_idx \(kind=\?\)/);
  db.close();
});

test("For You reads index ranges for every pool", () => {
  const db = catalogue();
  const seen = plans(db, () =>
    listForYouCandidates(db, 80, { genres: ["Drama"], decades: [1990] }),
  );
  const candidates = seen.filter(({ sql }) => sql.includes("pick"));
  assert.equal(candidates.length, 2, "popular and taste pools");
  for (const { sql, plan } of candidates)
    assert.doesNotMatch(plan, FULL_TABLE_SCAN, `${sql}\n=> ${plan}`);
  // Each kind is one range of the covering index past the vote floor; a scan
  // of the whole index cost about 45 ms on a real catalogue, the range 5 ms.
  assert.match(
    candidates[1]!.plan,
    /titles_kind_votes_cover_idx \(kind=\? AND imdb_votes>\?\)/,
  );
  db.close();
});

test("the library list keeps the library as the outer loop", () => {
  const db = catalogue();
  const [list] = plans(db, () => listLibrary(db));
  assert.match(list!.plan, /^SCAN l\b/);
  db.close();
});

test("the facets year range seeks each kind's ends", () => {
  const db = catalogue();
  const seen = plans(db, () => facets(db));
  const range = seen.find(({ sql }) => sql.includes("min(year)"));
  assert.match(range!.plan, /titles_kind_year_idx \(kind=\?\)/);
  assert.deepEqual(facets(db).years, { min: 1990, max: 1992 });
  db.close();
});

test("hydration reads only its partial indexes, even with statistics from a fresh build", () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-plans-"));
  const catalog = new CatalogDatabase(join(dir, "catalog.sqlite"));
  const db = (catalog as unknown as { db: Database.Database }).db;
  try {
    // ANALYZE right after a build sees every title pending, and records the
    // pending index as the whole table. The planner then preferred a scan.
    db.exec("ANALYZE");
    db.prepare("DELETE FROM sqlite_stat1 WHERE tbl = 'titles'").run();
    const stat = db.prepare(
      "INSERT INTO sqlite_stat1(tbl, idx, stat) VALUES ('titles', ?, ?)",
    );
    stat.run("titles_tmdb_pending_idx", "486488 1");
    stat.run("titles_tmdb_retry_idx", "486488 486488 1 1");
    stat.run("titles_votes_desc_idx", "486488 1 1");
    db.exec("ANALYZE sqlite_schema");
    const seen = plans(db, () => {
      catalog.hydrationStats();
      catalog.listTitlesNeedingPosters(400, [], true);
      catalog.requeueMissingMedia(Date.now(), 400);
    });
    const pending = seen.filter(({ sql }) =>
      sql.includes(TMDB_HYDRATION_PENDING_SQL),
    );
    assert.equal(pending.length, 3);
    for (const { sql, plan } of pending)
      assert.match(
        plan,
        /USING (COVERING )?INDEX titles_tmdb_(pending|retry)_idx/,
        sql,
      );
  } finally {
    catalog.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
