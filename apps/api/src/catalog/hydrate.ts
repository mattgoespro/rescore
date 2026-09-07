import type Database from "better-sqlite3";
import type { TitleDto } from "../catalog-types.js";
import type { TitleRow } from "./types.js";

export function toTitleDto(
  row: TitleRow,
  genres: string[],
  directors: string[],
  cast: string[],
): TitleDto {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    kind: row.kind,
    year: row.year,
    runtimeMinutes: row.runtime_minutes,
    synopsis: row.synopsis,
    posterUrl: row.poster_url || null,
    imdbRating: row.imdb_rating,
    imdbVotes: row.imdb_votes,
    genres,
    directors,
    cast,
  };
}

export function hydrateTitles(
  db: Database.Database,
  rows: TitleRow[],
): TitleDto[] {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const genreRows = db
    .prepare(
      `SELECT title_id, genre FROM title_genres WHERE title_id IN (${placeholders}) ORDER BY genre`,
    )
    .all(...ids) as Array<{ title_id: string; genre: string }>;
  const peopleRows = db
    .prepare(
      `SELECT title_id, name, role FROM title_people WHERE title_id IN (${placeholders}) ORDER BY role, position`,
    )
    .all(...ids) as Array<{
    title_id: string;
    name: string;
    role: "director" | "cast";
  }>;

  const genres = new Map<string, string[]>();
  for (const row of genreRows) {
    const list = genres.get(row.title_id) ?? [];
    list.push(row.genre);
    genres.set(row.title_id, list);
  }
  const directors = new Map<string, string[]>();
  const cast = new Map<string, string[]>();
  for (const row of peopleRows) {
    const bucket = row.role === "director" ? directors : cast;
    const list = bucket.get(row.title_id) ?? [];
    list.push(row.name);
    bucket.set(row.title_id, list);
  }

  return rows.map((row) =>
    toTitleDto(
      row,
      genres.get(row.id) ?? [],
      directors.get(row.id) ?? [],
      cast.get(row.id) ?? [],
    ),
  );
}
