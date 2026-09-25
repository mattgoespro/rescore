import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { CatalogDatabase } from "./database.js";

const dirs: string[] = [];

function openCatalog(): { catalog: CatalogDatabase; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rescore-hydration-"));
  dirs.push(dir);
  const path = join(dir, "catalog.sqlite");
  return { catalog: new CatalogDatabase(path), path };
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seed(catalog: CatalogDatabase, id: string, votes: number): void {
  catalog.insertTitleRows([
    {
      id,
      title: id,
      originalTitle: id,
      kind: "movie",
      year: 1999,
      runtimeMinutes: 100,
      imdbRating: 7,
      imdbVotes: votes,
      genres: ["Drama"],
    },
  ]);
}

function setMedia(
  path: string,
  id: string,
  posterUrl: string | null,
  synopsis: string | null,
  certification: string | null,
): void {
  const db = new Database(path);
  db.prepare(
    "UPDATE titles SET poster_url = ?, synopsis = ?, certification = ? WHERE id = ?",
  ).run(posterUrl, synopsis, certification, id);
  db.close();
}

test("empty catalog poster counts are zeros", () => {
  const { catalog } = openCatalog();
  try {
    assert.deepEqual(catalog.posterStats(), {
      total: 0,
      pending: 0,
      found: 0,
      missing: 0,
    });
  } finally {
    catalog.close();
  }
});

test("hydration stats distinguish pending nulls from completed misses", () => {
  const { catalog, path } = openCatalog();
  try {
    seed(catalog, "tt0000001", 10);
    seed(catalog, "tt0000002", 20);
    seed(catalog, "tt0000003", 30);
    seed(catalog, "tt0000004", 40);
    seed(catalog, "tt0000005", 50);
    setMedia(
      path,
      "tt0000001",
      "https://image.tmdb.org/t/p/w342/a.jpg",
      "Plot",
      "PG-13",
    );
    setMedia(path, "tt0000002", "", "", "");
    setMedia(path, "tt0000003", null, "Plot", "PG");
    setMedia(
      path,
      "tt0000004",
      "https://image.tmdb.org/t/p/w342/b.jpg",
      null,
      "R",
    );
    setMedia(
      path,
      "tt0000005",
      "https://image.tmdb.org/t/p/w342/c.jpg",
      "Plot",
      null,
    );

    assert.deepEqual(catalog.posterStats(), {
      total: 5,
      pending: 1,
      found: 3,
      missing: 1,
    });
    assert.deepEqual(catalog.hydrationStats(), {
      total: 5,
      processed: 2,
      pending: 3,
      complete: false,
      poster: { pending: 1, found: 3, missing: 1 },
      synopsis: { pending: 1, found: 3, missing: 1 },
      certification: { pending: 1, found: 3, missing: 1 },
    });
  } finally {
    catalog.close();
  }
});

test("empty catalog hydration state is complete with zero counts", () => {
  const { catalog } = openCatalog();
  try {
    assert.deepEqual(catalog.hydrationStats(), {
      total: 0,
      processed: 0,
      pending: 0,
      complete: true,
      poster: { pending: 0, found: 0, missing: 0 },
      synopsis: { pending: 0, found: 0, missing: 0 },
      certification: { pending: 0, found: 0, missing: 0 },
    });
  } finally {
    catalog.close();
  }
});

test("vote-ordered selection includes rows missing poster, synopsis, or certification", () => {
  const { catalog, path } = openCatalog();
  try {
    seed(catalog, "tt0000004", 400);
    seed(catalog, "tt0000003", 300);
    seed(catalog, "tt0000002", 200);
    seed(catalog, "tt0000001", 100);
    seed(catalog, "tt0000005", 50);
    setMedia(path, "tt0000004", "", "", "");
    setMedia(
      path,
      "tt0000003",
      "https://image.tmdb.org/t/p/w342/a.jpg",
      "Has plot",
      null,
    );
    setMedia(
      path,
      "tt0000002",
      "https://image.tmdb.org/t/p/w342/b.jpg",
      null,
      "R",
    );
    setMedia(path, "tt0000001", null, "Plot", "PG");

    const rows = catalog.listTitlesNeedingPosters(10, [], true);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["tt0000003", "tt0000002", "tt0000001", "tt0000005"],
    );
  } finally {
    catalog.close();
  }
});

test("priority selection includes certification-only pending rows", () => {
  const { catalog, path } = openCatalog();
  try {
    seed(catalog, "tt0000001", 10);
    setMedia(
      path,
      "tt0000001",
      "https://image.tmdb.org/t/p/w342/a.jpg",
      "Plot",
      null,
    );
    assert.equal(catalog.titleNeedsMedia("tt0000001"), true);
    assert.deepEqual(
      catalog.listTitlesNeedingPosters(10, ["TT0000001"], false).map((row) => row.id),
      ["tt0000001"],
    );
  } finally {
    catalog.close();
  }
});

test("pending hydration index supports the vote-ordered scan", () => {
  const { catalog, path } = openCatalog();
  try {
    const rows = [];
    for (let index = 1; index <= 40; index += 1) {
      rows.push({
        id: `tt${String(index).padStart(7, "0")}`,
        title: `Title ${index}`,
        originalTitle: `Title ${index}`,
        kind: "movie",
        year: 1999,
        runtimeMinutes: 100,
        imdbRating: 7,
        imdbVotes: index,
        genres: ["Drama"],
      });
    }
    catalog.insertTitleRows(rows);
    const db = new Database(path, { readonly: true });
    try {
      const index = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'titles_tmdb_pending_idx'",
        )
        .get() as { sql: string } | undefined;
      const sql = index?.sql;
      if (!sql) throw new Error("missing titles_tmdb_pending_idx");
      assert.match(sql, /imdb_votes DESC/);
      assert.match(sql, /poster_url IS NULL/);
      assert.match(sql, /synopsis IS NULL/);
      assert.match(sql, /certification IS NULL/);
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, kind FROM titles
           WHERE poster_url IS NULL OR synopsis IS NULL OR certification IS NULL
           ORDER BY imdb_votes DESC, id
           LIMIT 40`,
        )
        .all() as Array<{ detail: string }>;
      assert.match(
        plan.map((step) => step.detail).join("\n"),
        /titles_tmdb_pending_idx/,
      );
    } finally {
      db.close();
    }
  } finally {
    catalog.close();
  }
});

test("existing catalogs gain the pending hydration index", () => {
  const { catalog, path } = openCatalog();
  catalog.close();
  const raw = new Database(path);
  raw.exec("DROP INDEX IF EXISTS titles_tmdb_pending_idx");
  raw.prepare("DELETE FROM schema_migrations WHERE version = 12").run();
  raw.close();

  const upgraded = new CatalogDatabase(path);
  try {
    const db = new Database(path, { readonly: true });
    try {
      const index = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'titles_tmdb_pending_idx'",
        )
        .get() as { sql: string } | undefined;
      assert.match(index?.sql ?? "", /certification IS NULL/);
    } finally {
      db.close();
    }
  } finally {
    upgraded.close();
  }
});

test("completed no-result certification is stored without clearing pending media", () => {
  const { catalog } = openCatalog();
  try {
    seed(catalog, "tt0000001", 15);
    catalog.updatePosterUrls([{ id: "tt0000001", certification: "" }]);
    const row = catalog.mediaFor(["tt0000001"])[0];
    assert.equal(row?.certification, "");
    assert.equal(row?.posterUrl, null);
    assert.equal(row?.synopsis, null);
    assert.equal(catalog.titleNeedsMedia("tt0000001"), true);
  } finally {
    catalog.close();
  }
});

test("null certification stays pending after poster and synopsis misses", () => {
  const { catalog } = openCatalog();
  try {
    seed(catalog, "tt0000001", 80);
    catalog.updatePosterUrls([
      { id: "tt0000001", posterUrl: null, synopsis: null, certification: null },
    ]);
    const row = catalog.mediaFor(["tt0000001"])[0];
    assert.equal(row?.posterUrl, "");
    assert.equal(row?.synopsis, "");
    assert.equal(row?.certification, null);
    assert.equal(catalog.titleNeedsMedia("tt0000001"), true);
    assert.deepEqual(
      catalog.listTitlesNeedingPosters(10, [], true).map((item) => item.id),
      ["tt0000001"],
    );
  } finally {
    catalog.close();
  }
});

test("hydration writes keep useful values and completed misses", () => {
  const { catalog } = openCatalog();
  try {
    seed(catalog, "tt0000001", 90);
    catalog.updatePosterUrls([
      {
        id: "tt0000001",
        posterUrl: "https://image.tmdb.org/t/p/w342/keep.jpg",
        synopsis: "Keep",
        certification: "PG-13",
      },
    ]);
    catalog.updatePosterUrls([
      {
        id: "tt0000001",
        posterUrl: "",
        synopsis: "",
        certification: "",
      },
    ]);
    const kept = catalog.mediaFor(["tt0000001"])[0];
    assert.equal(kept?.posterUrl, "https://image.tmdb.org/t/p/w342/keep.jpg");
    assert.equal(kept?.synopsis, "Keep");
    assert.equal(kept?.certification, "PG-13");

    seed(catalog, "tt0000002", 70);
    catalog.updatePosterUrls([
      { id: "tt0000002", posterUrl: null, synopsis: null, certification: "" },
    ]);
    catalog.updatePosterUrls([
      {
        id: "tt0000002",
        posterUrl: "https://image.tmdb.org/t/p/w342/later.jpg",
        synopsis: "Later",
        certification: "R",
      },
    ]);
    const sticky = catalog.mediaFor(["tt0000002"])[0];
    assert.equal(sticky?.posterUrl, "");
    assert.equal(sticky?.synopsis, "");
    assert.equal(sticky?.certification, "");
    assert.equal(catalog.titleNeedsMedia("tt0000002"), false);
  } finally {
    catalog.close();
  }
});

test("title upserts do not clear stored poster, synopsis, or certification", () => {
  const { catalog } = openCatalog();
  try {
    seed(catalog, "tt0000001", 40);
    catalog.updatePosterUrls([
      {
        id: "tt0000001",
        posterUrl: "https://image.tmdb.org/t/p/w342/keep.jpg",
        synopsis: "Keep",
        certification: "PG-13",
      },
    ]);
    catalog.upsertTitles([
      {
        id: "tt0000001",
        title: "Renamed",
        originalTitle: "Renamed",
        kind: "movie",
        year: 2001,
      },
    ]);
    const row = catalog.mediaFor(["tt0000001"])[0];
    assert.equal(row?.posterUrl, "https://image.tmdb.org/t/p/w342/keep.jpg");
    assert.equal(row?.synopsis, "Keep");
    assert.equal(row?.certification, "PG-13");
    assert.equal(catalog.title("tt0000001")?.title, "Renamed");
  } finally {
    catalog.close();
  }
});
