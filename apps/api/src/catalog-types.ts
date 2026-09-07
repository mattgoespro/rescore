export type LibraryStatus = "watched" | "watchlist" | "skipped";

export interface TitleDto {
  id: string;
  title: string;
  originalTitle: string | null;
  kind: string;
  year: number | null;
  runtimeMinutes: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  genres: string[];
  directors: string[];
  cast: string[];
}

export interface TitleListResponse {
  data: TitleDto[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface FacetsResponse {
  genres: Array<{ value: string; count: number }>;
  kinds: Array<{ value: string; count: number }>;
  years: { min: number | null; max: number | null };
}

export interface LibraryEntryDto {
  title: TitleDto;
  status: LibraryStatus;
  personalRating: number | null;
  note: string | null;
  updatedAt: string;
}

export interface ImportStatusDto {
  id: string;
  kind: "catalog" | "ratings";
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  importedTitles: number;
  message: string | null;
}

export interface ForYouResponse {
  library: LibraryEntryDto[];
  facets: FacetsResponse;
  candidates: TitleDto[];
}
