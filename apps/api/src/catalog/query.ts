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
import { getMetaValue } from "./meta.js";
import { hydrateTitles } from "./hydrate.js";
import { IMDB_ID, type TitleQuery, type TitleRow } from "./types.js";

const countCache = new Map<string, number>();

const orderColumn = {
  title: "t.title COLLATE NOCASE",
  year: "t.year",
  rating: "t.imdb_rating",
  votes: "t.imdb_votes",
  updatedAt: "t.updated_at",
} as const;

function orderBy(sort: TitleQuery["sort"], order: "ASC" | "DESC"): string {
  const column = orderColumn[sort];
  if (sort === "rating") {
    return `${column} ${order}, t.imdb_votes ${order}, t.id ASC`;
  }
  return `${column} ${order}, t.id ASC`;
}

export function invalidateCountCache(): void {
  countCache.clear();
}

interface TitleCursor {
  id: string;
  votes: number | null;
  rating: number | null;
  year: number | null;
  title: string;
  updatedAt: string | null;
}

export function encodeTitleCursor(row: {
  id: string;
  imdb_votes: number | null;
  imdb_rating: number | null;
  year: number | null;
  title: string;
  updated_at?: string;
}): string {
  const payload: TitleCursor = {
    id: row.id,
    votes: row.imdb_votes,
    rating: row.imdb_rating,
    year: row.year,
    title: row.title,
    updatedAt: row.updated_at ?? null,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeTitleCursor(value: string): TitleCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<TitleCursor>;
    if (typeof parsed.id !== "string" || typeof parsed.title !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      votes: typeof parsed.votes === "number" ? parsed.votes : null,
      rating: typeof parsed.rating === "number" ? parsed.rating : null,
      year: typeof parsed.year === "number" ? parsed.year : null,
      title: parsed.title,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function cursorSortValue(
  sort: TitleQuery["sort"],
  cursor: Pick<TitleCursor, "title" | "year" | "rating" | "votes" | "updatedAt">,
): string | number | null {
  switch (sort) {
    case "title":
      return cursor.title;
    case "year":
      return cursor.year;
    case "rating":
      return cursor.rating;
    case "votes":
      return cursor.votes;
    case "updatedAt":
      return cursor.updatedAt;
  }
}

function seekCondition(
  sort: TitleQuery["sort"],
  order: "ASC" | "DESC",
  id: string,
  value: string | number | null,
  params: Record<string, string | number>,
): string {
  params.cursorId = id;
  if (value === null) {
    return "t.id > @cursorId";
  }
  params.cursorSort = value;
  const column = orderColumn[sort];
  const cmp = order === "DESC" ? "<" : ">";
  return `(${column} ${cmp} @cursorSort OR (${column} = @cursorSort AND t.id > @cursorId))`;
}

function buildCursorCondition(
  query: TitleQuery,
  order: "ASC" | "DESC",
  params: Record<string, string | number>,
): string | null {
  if (!query.cursor) return null;
  const cursor = decodeTitleCursor(query.cursor);
  if (!cursor) return null;
  const value = cursorSortValue(query.sort, cursor);
  return seekCondition(query.sort, order, cursor.id, value, params);
}

function mergeCondition(condition: string, extra: string | null): string {
  if (!extra) return condition;
  return condition ? `${condition} AND ${extra}` : `WHERE ${extra}`;
}

function computeNextCursor(
  db: Database.Database,
  query: TitleQuery,
  order: "ASC" | "DESC",
  condition: string,
  params: Record<string, string | number>,
  from: string,
  rows: TitleRow[],
): string | null {
  if (rows.length < query.pageSize) return null;
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return null;
  const rowSortValue = cursorSortValue(query.sort, {
    title: lastRow.title,
    year: lastRow.year,
    rating: lastRow.imdb_rating,
    votes: lastRow.imdb_votes,
    updatedAt: lastRow.updated_at,
  });
  const peekParams: Record<string, string | number> = { ...params };
  const peekCondition = mergeCondition(
    condition,
    seekCondition(query.sort, order, lastRow.id, rowSortValue, peekParams),
  );
  const hasMore = db
    .prepare(`SELECT 1 AS found FROM ${from} ${peekCondition} LIMIT 1`)
    .get(peekParams);
  return hasMore ? encodeTitleCursor(lastRow) : null;
}

export function listTitles(
  db: Database.Database,
  query: TitleQuery,
): TitleListResponse {
  const { condition, params, fts } = buildWhere(query, db);
  const order = query.order.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const useCursor = Boolean(query.cursor);
  const offset = useCursor ? 0 : (query.page - 1) * query.pageSize;
  const cacheKey = JSON.stringify({
    revision: getMetaValue(db, "revision") ?? "",
    skipRev: getMetaValue(db, "librarySkipRev") ?? "0",
    condition,
    params,
    fts,
  });
  const includeTotal = query.includeTotal !== false;
  const cached = countCache.get(cacheKey);

  const from = fts
    ? "titles t JOIN titles_fts f ON f.rowid = t.rowid"
    : "titles t";
  const rowParams: Record<string, string | number> = { ...params };
  const cursorCondition = useCursor
    ? buildCursorCondition(query, order, rowParams)
    : null;
  const rowCondition = mergeCondition(condition, cursorCondition);
  const rows = db
    .prepare(
      `SELECT t.* FROM ${from} ${rowCondition} ORDER BY ${orderBy(query.sort, order)} LIMIT @limit${useCursor ? "" : " OFFSET @offset"}`,
    )
    .all({
      ...rowParams,
      limit: query.pageSize,
      ...(useCursor ? {} : { offset }),
    }) as TitleRow[];

  let total: number;
  if (includeTotal || cached == null) {
    if (cached != null) {
      total = cached;
    } else {
      total = (
        db
          .prepare(`SELECT count(*) AS total FROM ${from} ${condition}`)
          .get(params) as { total: number }
      ).total;
      countCache.set(cacheKey, total);
    }
  } else if (cached != null) {
    total = cached;
  } else if (rows.length < query.pageSize) {
    total = offset + rows.length;
  } else {
    total = offset + rows.length + 1;
  }

  const nextCursor = computeNextCursor(db, query, order, condition, params, from, rows);

  return {
    data: hydrateTitles(db, rows),
    pagination: {
      page: useCursor ? 1 : query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      nextCursor,
    },
  };
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

function hasSkippedTitles(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM library_entries WHERE status = 'skipped' LIMIT 1",
      )
      .get(),
  );
}

function buildWhere(
  query: TitleQuery,
  db: Database.Database,
): {
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
  if (hasSkippedTitles(db)) {
    where.push(
      "NOT EXISTS (SELECT 1 FROM library_entries skipped WHERE skipped.title_id=t.id AND skipped.status='skipped')",
    );
  }
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
