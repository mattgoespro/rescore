import type Database from "better-sqlite3";
import type {
  FacetsResponse,
  LibraryEntryDto,
  LibraryStatus,
  TitleDto,
  TitleListResponse,
} from "../catalog-types.js";
import {
  readFacetsCache,
  writeFacetsCache,
} from "./facets-cache.js";
import { hydrateTitles } from "./hydrate.js";
import { IMDB_ID, type TitleQuery, type TitleRow } from "./types.js";

const COUNT_TTL_MS = 30_000;
const countCache = new Map<string, { total: number; expires: number }>();

const orderColumn = {
  title: "t.title COLLATE NOCASE",
  year: "t.year",
  rating: "t.bayesian_score",
  votes: "t.imdb_votes",
  updatedAt: "t.updated_at",
} as const;

export function invalidateCountCache(): void {
  countCache.clear();
}

export function listTitles(
  db: Database.Database,
  query: TitleQuery,
): TitleListResponse {
  const { condition, params, fts } = buildWhere(query);
  const order = query.order.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const sort = orderColumn[query.sort];
  const offset = (query.page - 1) * query.pageSize;
  const cacheKey = JSON.stringify({ condition, params, fts });
  const includeTotal = query.includeTotal !== false;
  const cached = countCache.get(cacheKey);
  const cacheHit = Boolean(cached && cached.expires > Date.now());

  const from = fts
    ? "titles t JOIN titles_fts f ON f.rowid = t.rowid"
    : "titles t";
  const rows = db
    .prepare(
      `SELECT t.* FROM ${from} ${condition} ORDER BY ${sort} ${order}, t.id ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset }) as TitleRow[];

  let total: number;
  if (includeTotal || !cacheHit) {
    if (cacheHit && cached) {
      total = cached.total;
    } else {
      total = (
        db
          .prepare(`SELECT count(*) AS total FROM ${from} ${condition}`)
          .get(params) as { total: number }
      ).total;
      countCache.set(cacheKey, { total, expires: Date.now() + COUNT_TTL_MS });
    }
  } else if (cached) {
    total = cached.total;
  } else if (rows.length < query.pageSize) {
    total = offset + rows.length;
  } else {
    total = offset + rows.length + 1;
  }

  return {
    data: hydrateTitles(db, rows),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export function listTitleIds(db: Database.Database, query: TitleQuery): string[] {
  const { condition, params, fts } = buildWhere(query);
  const order = query.order.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const sort = orderColumn[query.sort];
  const offset = (query.page - 1) * query.pageSize;
  const from = fts
    ? "titles t JOIN titles_fts f ON f.rowid = t.rowid"
    : "titles t";
  const rows = db
    .prepare(
      `SELECT t.id FROM ${from} ${condition} ORDER BY ${sort} ${order}, t.id ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset }) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function titleById(db: Database.Database, id: string): TitleDto | null {
  const row = db
    .prepare("SELECT * FROM titles WHERE id = ?")
    .get(id.toLowerCase()) as TitleRow | undefined;
  return row ? (hydrateTitles(db, [row])[0] ?? null) : null;
}

export function facets(db: Database.Database): FacetsResponse {
  const cached = readFacetsCache();
  if (cached) return cached;
  return writeFacetsCache({
    genres: db
      .prepare(
        "SELECT genre AS value, count(*) AS count FROM title_genres GROUP BY genre ORDER BY count DESC, genre",
      )
      .all() as FacetsResponse["genres"],
    kinds: db
      .prepare(
        "SELECT kind AS value, count(*) AS count FROM titles GROUP BY kind ORDER BY count DESC, kind",
      )
      .all() as FacetsResponse["kinds"],
    years: db
      .prepare("SELECT min(year) AS min, max(year) AS max FROM titles")
      .get() as FacetsResponse["years"],
  });
}

export function listLibrary(
  db: Database.Database,
  status?: LibraryStatus,
): LibraryEntryDto[] {
  const rows = db
    .prepare(
      `SELECT l.status,l.personal_rating,l.note,l.updated_at,t.* FROM library_entries l JOIN titles t ON t.id=l.title_id ${status ? "WHERE l.status=?" : ""} ORDER BY l.updated_at DESC`,
    )
    .all(...(status ? [status] : [])) as Array<
    TitleRow & {
      status: LibraryStatus;
      personal_rating: number | null;
      note: string | null;
      updated_at: string;
    }
  >;
  const titles = hydrateTitles(db, rows);
  return rows.map((row, index) => ({
    title: titles[index]!,
    status: row.status,
    personalRating: row.personal_rating,
    note: row.note,
    updatedAt: row.updated_at,
  }));
}

export function listForYouCandidates(
  db: Database.Database,
  limit: number,
): TitleDto[] {
  const rows = db
    .prepare(
      `SELECT t.* FROM titles t
       WHERE t.imdb_votes >= 5000
         AND NOT EXISTS (SELECT 1 FROM library_entries e WHERE e.title_id=t.id AND e.status IN ('watched','skipped'))
       ORDER BY t.imdb_votes DESC, t.id ASC
       LIMIT ?`,
    )
    .all(limit) as TitleRow[];
  return hydrateTitles(db, rows);
}

function buildWhere(query: TitleQuery): {
  condition: string;
  params: Record<string, string | number>;
  fts: boolean;
} {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  let fts = false;
  const raw = query.query?.trim();
  if (raw) {
    if (IMDB_ID.test(raw)) {
      where.push("t.id=@id");
      params.id = raw.toLowerCase();
    } else {
      const match = toFtsQuery(raw);
      if (match) {
        where.push("titles_fts MATCH @fts");
        params.fts = match;
        fts = true;
      }
    }
  }
  if (query.genres?.length) {
    const placeholders = query.genres.map((_, index) => {
      const key = `genre${index}`;
      params[key] = query.genres![index]!;
      return `@${key}`;
    });
    where.push(
      `EXISTS (SELECT 1 FROM title_genres g WHERE g.title_id=t.id AND g.genre IN (${placeholders.join(",")}))`,
    );
  }
  if (query.kind) {
    where.push("t.kind=@kind");
    params.kind = query.kind;
  }
  for (const [field, value] of [
    ["year >= @yearMin", query.yearMin],
    ["year <= @yearMax", query.yearMax],
    ["imdb_rating >= @ratingMin", query.ratingMin],
    ["imdb_votes >= @votesMin", query.votesMin],
    ["runtime_minutes >= @runtimeMin", query.runtimeMin],
    ["runtime_minutes <= @runtimeMax", query.runtimeMax],
  ] as const) {
    if (value !== undefined) {
      where.push(`t.${field}`);
      params[field.match(/@(\w+)/)?.[1] ?? ""] = value;
    }
  }
  where.push(
    "NOT EXISTS (SELECT 1 FROM library_entries skipped WHERE skipped.title_id=t.id AND skipped.status='skipped')",
  );
  if (query.hideWatched) {
    where.push(
      "NOT EXISTS (SELECT 1 FROM library_entries watched WHERE watched.title_id=t.id AND watched.status='watched')",
    );
  }
  if (query.hideWatchlist) {
    where.push(
      "NOT EXISTS (SELECT 1 FROM library_entries watchlist WHERE watchlist.title_id=t.id AND watchlist.status='watchlist')",
    );
  }
  return {
    condition: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    fts,
  };
}

function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .replace(/["*():^,-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length > 0);
  if (!tokens.length) return null;
  return tokens.map((token) => `${token}*`).join(" AND ");
}
