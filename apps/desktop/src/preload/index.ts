import { contextBridge, ipcRenderer } from "electron";
import type {
  CatalogStatus,
  DiscoverFilters,
  ForYouResult,
  Genre,
  ImportProgress,
  LibraryEntry,
  MediaType,
  MovieDetails,
  MovieEnrichment,
  MovieSummary,
  PagedMovies,
  PersonRef,
  SearchHistoryEntry,
  Settings,
  TasteProfile,
  WatchStatus,
} from "../shared/types";
import type { SearchHistoryInput } from "../shared/search-history";

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke("settings:set", patch),
  configured: (): Promise<boolean> => ipcRenderer.invoke("catalog:configured"),
  catalogStatus: (): Promise<CatalogStatus> =>
    ipcRenderer.invoke("catalog:status"),
  retryCatalog: (): Promise<CatalogStatus> =>
    ipcRenderer.invoke("catalog:retry"),
  rebuildCatalog: (): Promise<CatalogStatus> =>
    ipcRenderer.invoke("catalog:rebuild"),
  onCatalogStatus: (handler: (status: CatalogStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: CatalogStatus): void =>
      handler(status);
    ipcRenderer.on("catalog:status", listener);
    return () => ipcRenderer.removeListener("catalog:status", listener);
  },
  genres: (mediaType?: MediaType): Promise<Genre[]> =>
    ipcRenderer.invoke("catalog:genres", mediaType),
  searchPeople: (query: string): Promise<PersonRef[]> =>
    ipcRenderer.invoke("catalog:searchPeople", query),
  discover: (filters: DiscoverFilters): Promise<PagedMovies> =>
    ipcRenderer.invoke("catalog:discover", filters),
  movie: (id: string, _mediaType?: MediaType): Promise<MovieDetails | null> =>
    ipcRenderer.invoke("catalog:title", id),
  fillMedia: (
    ids: string[],
  ): Promise<
    Array<{
      id: string;
      synopsis: string | null;
      posterUrl: string | null;
      certification: string | null;
    }>
  > => ipcRenderer.invoke("catalog:fillMedia", ids),
  movieMeta: (
    movies: MovieSummary[],
  ): Promise<Record<string, MovieEnrichment>> =>
    ipcRenderer.invoke("catalog:movieMeta", movies),
  listLibrary: (): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke("library:list"),
  upsertLibrary: (payload: {
    movie: MovieSummary | MovieDetails;
    status: WatchStatus;
    rating?: number;
  }): Promise<LibraryEntry[]> => ipcRenderer.invoke("library:upsert", payload),
  removeLibrary: (
    imdbId: string,
    _mediaType?: MediaType,
  ): Promise<LibraryEntry[]> => ipcRenderer.invoke("library:remove", imdbId),
  clearLibrary: (): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke("library:clear"),
  exportLibrary: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke("library:export"),
  importImdbCsv: (): Promise<ImportProgress> =>
    ipcRenderer.invoke("library:importImdbCsv"),
  listSearchHistory: (): Promise<SearchHistoryEntry[]> =>
    ipcRenderer.invoke("search-history:list"),
  saveSearchHistory: (
    input: SearchHistoryInput,
  ): Promise<SearchHistoryEntry[]> =>
    ipcRenderer.invoke("search-history:save", input),
  removeSearchHistory: (id: string): Promise<SearchHistoryEntry[]> =>
    ipcRenderer.invoke("search-history:remove", id),
  forYou: (): Promise<ForYouResult> => ipcRenderer.invoke("ranking:forYou"),
  profile: (): Promise<TasteProfile> => ipcRenderer.invoke("ranking:profile"),
  onImportProgress: (
    handler: (progress: ImportProgress) => void,
  ): (() => void) => {
    const listener = (_event: unknown, progress: ImportProgress): void =>
      handler(progress);
    ipcRenderer.on("library:importProgress", listener);
    return () => ipcRenderer.removeListener("library:importProgress", listener);
  },
};

export type RescoreAPI = typeof api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
