import type Database from "better-sqlite3";
import type {
  FacetsResponse,
  LibraryEntryDto,
  LibraryStatus,
  TitleDto,
  TitleListResponse,
} from "../catalog-types.js";
import { queryCache, FACETS_TTL_MS } from "./query-cache.js";
import { getMetaValue } from "./meta.js";
import { hydrateTitles } from "./hydrate.js";
import { excludedLibraryStatuses } from "./library-visibility.js";
import { IMDB_ID, type TitleQuery, type TitleRow } from "./types.js";

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

interface SeekColumn {
  expr: string;
  direction: "ASC" | "DESC";
  value: string | number | null;
  param: string;
}

/**
 * Mirrors `orderBy()` exactly: every sort ties on `t.id ASC`, and `rating`
 * additionally ties on `t.imdb_votes` (same direction as the primary column)
 * before falling back to `t.id`. Keeping these two in lockstep is required
 * for keyset paging to be a stable traversal of the declared ORDER BY.
 */
function seekColumns(
  sort: TitleQuery["sort"],
  order: "ASC" | "DESC",
  cursor: TitleCursor,
): SeekColumn[] {
  const idColumn: SeekColumn = {
    expr: "t.id",
    direction: "ASC",
    value: cursor.id,
    param: "cursorId",
  };
  switch (sort) {
    case "rating":
      return [
        {
          expr: "t.imdb_rating",
          direction: order,
          value: cursor.rating,
          param: "cursorRating",
        },
        {
          expr: "t.imdb_votes",
          direction: order,
          value: cursor.votes,
          param: "cursorVotes",
        },
        idColumn,
      ];
    case "votes":
      return [
        {
          expr: "t.imdb_votes",
          direction: order,
          value: cursor.votes,
          param: "cursorVotes",
        },
        idColumn,
      ];
    case "year":
      return [
        {
          expr: "t.year",
          direction: order,
          value: cursor.year,
          param: "cursorYear",
        },
        idColumn,
      ];
    case "updatedAt":
      return [
        {
          expr: "t.updated_at",
          direction: order,
          value: cursor.updatedAt,
          param: "cursorUpdatedAt",
        },
        idColumn,
      ];
    case "title":
      return [
        {
          expr: "t.title COLLATE NOCASE",
          direction: order,
          value: cursor.title,
          param: "cursorTitle",
        },
        idColumn,
      ];
  }
}

/**
 * SQLite treats NULL as smaller than any other value, so it sorts first in
 * ASC and last in DESC. "Strictly after" a non-null value in DESC therefore
 * includes every NULL row (they come later than any non-null value); "strictly
 * after" a NULL value in DESC is impossible (NULL is already the last
 * position) so that branch is dropped entirely. ASC is the mirror image.
 */
function afterClause(
  column: SeekColumn,
  params: Record<string, string | number>,
): string | null {
  if (column.value === null) {
    return column.direction === "ASC" ? `${column.expr} IS NOT NULL` : null;
  }
  params[column.param] = column.value;
  return column.direction === "DESC"
    ? `(${column.expr} < @${column.param} OR ${column.expr} IS NULL)`
    : `${column.expr} > @${column.param}`;
}

function sameClause(
  column: SeekColumn,
  params: Record<string, string | number>,
): string {
  if (column.value === null) return `${column.expr} IS NULL`;
  params[column.param] = column.value;
  return `${column.expr} = @${column.param}`;
}

/**
 * General multi-column keyset predicate: for each ordering column in turn,
 * "all earlier columns tie AND this column is strictly after the cursor",
 * OR'd together. This is the standard way to make a WHERE clause traverse a
 * multi-column ORDER BY exactly, including NULLs.
 */
function buildKeysetCondition(
  columns: SeekColumn[],
  params: Record<string, string | number>,
): string {
  const branches: string[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    const pivot = columns[i]!;
    const after = afterClause(pivot, params);
    if (after === null) continue;
    const equalities = columns
      .slice(0, i)
      .map((column) => sameClause(column, params));
    branches.push(
      equalities.length ? `(${equalities.join(" AND ")} AND ${after})` : after,
    );
  }
  return branches.length ? `(${branches.join(" OR ")})` : "0=1";
}

interface Segment {
  condition: string | null;
  params: Record<string, string | number>;
}

/**
 * The keyset predicate as ordered segments, each one index range. A single OR
 * across the leading column defeats the sort index: SQLite gathers every
 * remaining match and sorts it before applying LIMIT. Bounding the leading
 * column with `<=` / `>=` lets the scan walk the index and stop at the page
 * size; the strict comparison inside narrows the tie back to the tail columns.
 * NULLs in the leading column sit at the far end of that range, so they become
 * a segment of their own, read only once the bounded one runs short.
 */
function keysetSegments(columns: SeekColumn[]): Segment[] {
  const [lead, ...tail] = columns;
  const params: Record<string, string | number> = {};
  const tie = buildKeysetCondition(tail, params);
  if (lead!.value === null) {
    const segments: Segment[] = [
      { condition: `(${lead!.expr} IS NULL AND ${tie})`, params },
    ];
    if (lead!.direction === "ASC")
      segments.push({ condition: `${lead!.expr} IS NOT NULL`, params: {} });
    return segments;
  }
  params[lead!.param] = lead!.value;
  const after = lead!.direction === "DESC" ? "<" : ">";
  const segments: Segment[] = [
    {
      condition: `(${lead!.expr} ${after}= @${lead!.param} AND (${lead!.expr} ${after} @${lead!.param} OR ${tie}))`,
      params,
    },
  ];
  if (lead!.direction === "DESC")
    segments.push({ condition: `${lead!.expr} IS NULL`, params: {} });
  return segments;
}

function cursorSegments(query: TitleQuery, order: "ASC" | "DESC"): Segment[] {
  const cursor = query.cursor ? decodeTitleCursor(query.cursor) : null;
  if (!cursor) return [{ condition: null, params: {} }];
  return keysetSegments(seekColumns(query.sort, order, cursor));
}

function mergeCondition(condition: string, extra: string | null): string {
  if (!extra) return condition;
  return condition ? `${condition} AND ${extra}` : `WHERE ${extra}`;
}

/**
 * Indexes whose order matches each sort under a `kind` filter. Without
 * statistics the planner prefers whichever index narrows a filter most, then
 * sorts every match; naming the index keeps the scan in result order.
 */
const sortIndex: Partial<Record<TitleQuery["sort"], string>> = {
  votes: "titles_kind_votes_cover_idx",
  rating: "titles_kind_rating_idx",
  year: "titles_kind_year_idx",
};

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
  const counts = queryCache(db).counts;
  const cached = counts.get(cacheKey);

  // CROSS JOIN pins the full-text hits as the outer loop. Otherwise the planner
  // can walk a sort index over every title and re-run MATCH for each one.
  const from = fts
    ? "titles_fts f CROSS JOIN titles t ON t.rowid = f.rowid"
    : "titles t";
  const index = sortIndex[query.sort];
  const rowFrom =
    index && query.kind && !fts && params.id === undefined
      ? `titles t INDEXED BY ${index}`
      : from;
  // One row past the page answers whether another page exists.
  const fetched: TitleRow[] = [];
  for (const segment of cursorSegments(query, order)) {
    const limit = query.pageSize + 1 - fetched.length;
    if (limit <= 0) break;
    fetched.push(
      ...(db
        .prepare(
          `SELECT t.* FROM ${rowFrom} ${mergeCondition(condition, segment.condition)} ORDER BY ${orderBy(query.sort, order)} LIMIT @limit${useCursor ? "" : " OFFSET @offset"}`,
        )
        .all({
          ...params,
          ...segment.params,
          limit,
          ...(useCursor ? {} : { offset }),
        }) as TitleRow[]),
    );
  }
  const rows = fetched.slice(0, query.pageSize);

  let total: number | null;
  if (includeTotal) {
    if (cached != null) {
      total = cached;
    } else {
      total = (
        db
          .prepare(`SELECT count(*) AS total FROM ${from} ${condition}`)
          .get(params) as { total: number }
      ).total;
      counts.set(cacheKey, total);
    }
  } else if (cached != null) {
    total = cached;
  } else if (!useCursor && rows.length < query.pageSize) {
    total = offset + rows.length;
  } else {
    total = null;
  }

  const lastRow = rows[rows.length - 1];
  const nextCursor =
    fetched.length > query.pageSize && lastRow
      ? encodeTitleCursor(lastRow)
      : null;

  return {
    data: hydrateTitles(db, rows),
    pagination: {
      page: useCursor ? 1 : query.page,
      pageSize: query.pageSize,
      total,
      totalPages:
        total == null ? null : Math.max(1, Math.ceil(total / query.pageSize)),
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
  const cache = queryCache(db);
  if (cache.facets && Date.now() <= cache.facets.expires)
    return cache.facets.value;
  const value: FacetsResponse = {
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
  };
  cache.facets = { value, expires: Date.now() + FACETS_TTL_MS };
  return value;
}

export function libraryEntriesFromWrites(
  db: Database.Database,
  rows: Array<{
    title_id: string;
    status: LibraryStatus;
    personal_rating: number | null;
    rated_at: string | null;
    note: string | null;
    updated_at: string;
  }>,
): LibraryEntryDto[] {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.title_id);
  const placeholders = ids.map(() => "?").join(",");
  const titleRows = db
    .prepare(`SELECT * FROM titles WHERE id IN (${placeholders})`)
    .all(...ids) as TitleRow[];
  const titles = new Map(
    hydrateTitles(db, titleRows).map((title) => [title.id, title]),
  );
  return rows.flatMap((row) => {
    const title = titles.get(row.title_id);
    if (!title) return [];
    return [
      {
        title,
        status: row.status,
        personalRating: row.personal_rating,
        ratedAt: row.rated_at,
        note: row.note,
        updatedAt: row.updated_at,
      },
    ];
  });
}

/**
 * CROSS JOIN keeps the library as the outer loop. ANALYZE taken while the
 * library was empty leaves it without statistics, and the planner then scans
 * every title probing for an entry.
 */
export function libraryListSql(status?: LibraryStatus): string {
  return `SELECT l.status,l.personal_rating,l.rated_at,l.note,l.updated_at AS library_updated_at,t.* FROM library_entries l CROSS JOIN titles t ON t.id=l.title_id ${status ? "WHERE l.status=?" : ""} ORDER BY l.updated_at DESC, l.title_id`;
}

export function listLibrary(
  db: Database.Database,
  status?: LibraryStatus,
): LibraryEntryDto[] {
  const rows = db
    .prepare(libraryListSql(status))
    .all(...(status ? [status] : [])) as Array<
    TitleRow & {
      status: LibraryStatus;
      personal_rating: number | null;
      rated_at: string | null;
      note: string | null;
      library_updated_at: string;
    }
  >;
  const titles = hydrateTitles(db, rows);
  return rows.map((row, index) => ({
    title: titles[index]!,
    status: row.status,
    personalRating: row.personal_rating,
    ratedAt: row.rated_at,
    note: row.note,
    updatedAt: row.library_updated_at,
  }));
}

export function listForYouCandidates(
  db: Database.Database,
  limit: number,
): TitleDto[] {
  const params: Record<string, string | number> = { limit };
  const exclusion = libraryExclusionClause(
    excludedLibraryStatuses({ kind: "forYou" }),
    params,
    db,
  );
  const where = ["t.imdb_votes >= 5000", exclusion]
    .filter(Boolean)
    .join(" AND ");
  const rows = db
    .prepare(
      `SELECT t.* FROM titles t
       WHERE ${where}
       ORDER BY t.imdb_votes DESC, t.id ASC
       LIMIT @limit`,
    )
    .all(params) as TitleRow[];
  return hydrateTitles(db, rows);
}

/**
 * The `genre_mask` bits for `genres`, or null when one of them is stored but
 * has no bit, which leaves the filter to `title_genres`. A genre no title has
 * contributes nothing, matching what the `EXISTS` form would find.
 */
function genreBits(db: Database.Database, genres: string[]): number | null {
  const placeholders = genres.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT genre, bit FROM genre_bits WHERE genre IN (${placeholders})`,
    )
    .all(...genres) as Array<{ genre: string; bit: number }>;
  const bits = new Map(rows.map((row) => [row.genre, row.bit]));
  const stored = db.prepare(
    "SELECT 1 FROM title_genres WHERE genre = ? LIMIT 1",
  );
  // JS bitwise operators truncate to 32 bits, so the mask is a sum of
  // distinct powers of two.
  const set = new Set<number>();
  for (const genre of genres) {
    const bit = bits.get(genre);
    if (bit !== undefined) set.add(bit);
    else if (stored.get(genre)) return null;
  }
  let mask = 0;
  for (const bit of set) mask += 2 ** bit;
  return mask;
}

function hasSkippedTitles(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM library_entries WHERE status = 'skipped' LIMIT 1")
      .get(),
  );
}

function libraryExclusionClause(
  statuses: Array<"watched" | "watchlist" | "skipped">,
  params: Record<string, string | number>,
  db: Database.Database,
): string | null {
  const active = statuses.filter(
    (status) => status !== "skipped" || hasSkippedTitles(db),
  );
  if (!active.length) return null;
  const placeholders = active.map((status, index) => {
    const key = `libraryStatus${index}`;
    params[key] = status;
    return `@${key}`;
  });
  return `NOT EXISTS (SELECT 1 FROM library_entries excluded WHERE excluded.title_id=t.id AND excluded.status IN (${placeholders.join(",")}))`;
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
  const genreMask = query.genres?.length ? genreBits(db, query.genres) : null;
  const withoutGenreMask = query.withoutGenres?.length
    ? genreBits(db, query.withoutGenres)
    : null;
  if (genreMask !== null) {
    where.push("(t.genre_mask & @genreMask) != 0");
    params.genreMask = genreMask;
  } else if (query.genres?.length) {
    const placeholders = query.genres.map((_, index) => {
      const key = `genre${index}`;
      params[key] = query.genres![index]!;
      return `@${key}`;
    });
    where.push(
      `EXISTS (SELECT 1 FROM title_genres g WHERE g.title_id=t.id AND g.genre IN (${placeholders.join(",")}))`,
    );
  }
  if (withoutGenreMask !== null) {
    where.push("(t.genre_mask & @withoutGenreMask) = 0");
    params.withoutGenreMask = withoutGenreMask;
  } else if (query.withoutGenres?.length) {
    const placeholders = query.withoutGenres.map((_, index) => {
      const key = `withoutGenre${index}`;
      params[key] = query.withoutGenres![index]!;
      return `@${key}`;
    });
    where.push(
      `NOT EXISTS (SELECT 1 FROM title_genres gx WHERE gx.title_id = t.id AND gx.genre IN (${placeholders.join(",")}))`,
    );
  }
  if (query.directors?.length) {
    for (const [index, name] of query.directors.entries()) {
      const key = `director${index}`;
      params[key] = name;
      where.push(
        `EXISTS (SELECT 1 FROM title_people tp JOIN people p ON p.nconst = tp.nconst WHERE tp.title_id = t.id AND tp.role = 'director' AND p.name = @${key})`,
      );
    }
  }
  if (query.cast?.length) {
    for (const [index, name] of query.cast.entries()) {
      const key = `cast${index}`;
      params[key] = name;
      where.push(
        `EXISTS (SELECT 1 FROM title_people tp JOIN people p ON p.nconst = tp.nconst WHERE tp.title_id = t.id AND tp.role = 'cast' AND p.name = @${key})`,
      );
    }
  }
  if (query.withoutLanguages?.length) {
    const placeholders = query.withoutLanguages.map((_, index) => {
      const key = `withoutLanguage${index}`;
      params[key] = query.withoutLanguages![index]!;
      return `@${key}`;
    });
    where.push(
      `NOT EXISTS (SELECT 1 FROM title_languages tl WHERE tl.title_id = t.id AND tl.language IN (${placeholders.join(",")}))`,
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
  if (query.ratingMax !== undefined) {
    where.push("(t.imdb_rating IS NULL OR t.imdb_rating <= @ratingMax)");
    params.ratingMax = query.ratingMax;
  }
  const exclusion = libraryExclusionClause(
    excludedLibraryStatuses({
      kind: "discover",
      hideWatched: query.hideWatched,
      hideWatchlist: query.hideWatchlist,
    }),
    params,
    db,
  );
  if (exclusion) where.push(exclusion);
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
