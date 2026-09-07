import { contextBridge, ipcRenderer } from "electron";
import type {
  CatalogStatus,
  DiscoverFilters,
  ForYouResult,
  Genre,
  ImportProgress,
  LibraryEntry,
  MovieDetails,
  MovieEnrichment,
  MovieSummary,
  PagedMovies,
  Settings,
  TasteProfile,
  WatchProvider,
  WatchStatus,
  KeywordRef,
  MediaType,
  PersonRef,
} from "../shared/types";

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
  providers: (): Promise<WatchProvider[]> =>
    ipcRenderer.invoke("catalog:providers"),
  searchPeople: (query: string): Promise<PersonRef[]> =>
    ipcRenderer.invoke("catalog:searchPeople", query),
  searchKeywords: (query: string): Promise<KeywordRef[]> =>
    ipcRenderer.invoke("catalog:searchKeywords", query),
  discover: (filters: DiscoverFilters): Promise<PagedMovies> =>
    ipcRenderer.invoke("catalog:discover", filters),
  movie: (id: string, _mediaType?: MediaType): Promise<MovieDetails | null> =>
    ipcRenderer.invoke("catalog:title", id),
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
  ): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke("library:remove", imdbId),
  clearLibrary: (): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke("library:clear"),
  exportLibrary: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke("library:export"),
  importImdbCsv: (): Promise<ImportProgress> =>
    ipcRenderer.invoke("library:importImdbCsv"),
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

export type ImdbrainAPI = typeof api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
