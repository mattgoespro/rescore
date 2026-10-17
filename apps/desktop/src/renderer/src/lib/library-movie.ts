import type { LibraryEntry, MovieSummary } from "../../../shared/types";

export function libraryMovie(entry: LibraryEntry): MovieSummary {
  return {
    ...entry,
    mediaType: entry.mediaType ?? "movie",
    titleKind: entry.titleKind ?? (entry.mediaType === "tv" ? "tv" : "movie"),
    overview: entry.overview ?? "",
    posterPath: entry.posterPath ?? null,
    backdropPath: entry.backdropPath ?? null,
    releaseDate: entry.releaseDate ?? "",
    originalLanguage: entry.originalLanguage ?? "",
    popularity: 0,
    adult: false,
  };
}
