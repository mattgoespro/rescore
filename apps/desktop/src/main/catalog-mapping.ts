import type { LibraryEntryDto } from "../shared/catalog-dto";
import { movieFromTitle, type LibraryEntry } from "../shared/movie";

export function libraryEntryFromDto(row: LibraryEntryDto): LibraryEntry {
  const movie = movieFromTitle(row.title);
  return {
    ...movie,
    status: row.status,
    rating: row.personalRating ?? undefined,
    updatedAt: row.updatedAt,
    ratedAt: row.ratedAt ?? undefined,
    directorIds: movie.directorIds ?? [],
    directorNames: movie.directorNames ?? [],
    castIds: movie.castIds ?? [],
    castNames: movie.castNames ?? [],
  };
}
