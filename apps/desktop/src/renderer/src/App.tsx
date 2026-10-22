import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { isAppearanceOnlyPatch } from "../../shared/appearance";
import { applySearchHistory } from "../../shared/search-history";
import type {
  AppView,
  CatalogStatus,
  DiscoverFilters,
  Genre,
  LibraryEntry,
  MovieDetails,
  MovieSummary,
  Settings,
  TasteProfile,
} from "../../shared/types";
import {
  defaultFilters,
  defaultSettings,
  mediaTypeOf,
  setMediaProxyOrigin,
  titleKey,
} from "../../shared/types";
import CatalogLoader from "./components/catalog-loader";
import Inspector from "./components/inspector";
import TopBar from "./components/top-bar";
import { applyAppearance } from "./lib/appearance";
import { catalogLoaderDetail, isCatalogUiBlocked } from "./lib/catalog-busy";
import {
  MEDIA_RETRY_MS,
  clearPendingRetries,
  mediaFillSettled,
  mediaIdsToFill,
} from "./lib/use-visible-media";
import { cn } from "./lib/cn";
import { listSearchHistory } from "./lib/search-history-store";
import { btn } from "./lib/ui";
import { libraryMovie } from "./lib/library-movie";
import Discover from "./views/Discover";
import ForYou from "./views/ForYou";
import Library from "./views/Library";
import SettingsView from "./views/Settings";
import { loadTmdbHealth } from "./lib/tmdb-health";

export default function App(): JSX.Element {
  const [view, setView] = useState<AppView>("discover");
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [movieGenres, setMovieGenres] = useState<Genre[]>([]);
  const [tvGenres, setTvGenres] = useState<Genre[]>([]);
  const [library, setLibraryState] = useState<LibraryEntry[]>([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const setLibrary = useCallback((next: LibraryEntry[]) => {
    setLibraryState(next);
    setLibraryRevision((revision) => revision + 1);
  }, []);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>(defaultFilters);
  const [selected, setSelected] = useState<MovieSummary | null>(null);
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undoEntry, setUndoEntry] = useState<LibraryEntry | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const undoButton = useRef<HTMLButtonElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const libraryActing = useRef(false);
  const settingsDirty = useRef(false);
  const onSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirty.current = dirty;
  }, []);
  const navigate = useCallback(
    (next: AppView) => {
      if (next === view) return;
      if (
        view === "settings" &&
        settingsDirty.current &&
        !confirm("Discard your unsaved settings?")
      )
        return;
      setView(next);
    },
    [view],
  );

  useEffect(() => {
    if (document.activeElement !== document.body) return;
    if (undoEntry) undoButton.current?.focus();
    else if (notice) document.getElementById("main-content")?.focus();
  }, [undoEntry, notice, libraryBusy]);
  const [booting, setBooting] = useState(true);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(
    null,
  );
  const detailsCache = useRef(new Map<string, MovieDetails>());

  const genres =
    mediaTypeOf(filters.titleKind) === "tv" ? tvGenres : movieGenres;
  const genreMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const genre of movieGenres) map.set(genre.id, genre.name);
    for (const genre of tvGenres) {
      if (!map.has(genre.id)) map.set(genre.id, genre.name);
    }
    return map;
  }, [movieGenres, tvGenres]);

  const refresh = useCallback(async () => {
    const [nextSettings, nextLibrary] = await Promise.all([
      window.api.getSettings(),
      window.api.listLibrary(),
    ]);
    setSettings(nextSettings);
    setMediaProxyOrigin(nextSettings.catalogApiUrl);
    setLibrary(nextLibrary);
    const [nextGenres, nextProfile] = await Promise.all([
      window.api.genres().catch(() => [] as Genre[]),
      window.api.profile().catch(() => null),
    ]);
    setMovieGenres(nextGenres);
    setTvGenres(nextGenres);
    setProfile(nextProfile);
  }, []);

  useEffect(() => {
    void window.api.getSettings().then((next) => {
      setSettings(next);
      setMediaProxyOrigin(next.catalogApiUrl);
      applyAppearance(next);
    });
    void window.api.catalogStatus().then(setCatalogStatus);
    void listSearchHistory().then((entries) => {
      const latest = entries[0];
      if (latest) {
        setFilters((current) => applySearchHistory(current, latest));
      }
    });
    return window.api.onCatalogStatus(setCatalogStatus);
  }, []);

  useEffect(() => {
    if (catalogStatus?.phase === "error") {
      // Error UI is independent of booting. A later service recovery must still
      // perform the initial library/profile/genre load.
      setBooting(true);
      return;
    }
    if (isCatalogUiBlocked(catalogStatus)) return;
    const shouldRefresh = booting;
    setBooting(false);
    if (!shouldRefresh) return;
    setError("");
    void refresh().catch((err: Error) => setError(err.message));
    // Warm the coverage reading so Settings opens with its bars already filled.
    void loadTmdbHealth().catch(() => undefined);
  }, [catalogStatus, refresh, booting]);

  useEffect(() => {
    if (booting) return;
    applyAppearance(settings);
  }, [booting, settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (
        event.key === "Escape" &&
        !(event.target as HTMLElement)?.closest(
          '[role="dialog"], [role="listbox"], [role="combobox"]',
        )
      )
        setSelected(null);
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        queryInput.current?.focus();
        queryInput.current?.select();
      }
      if (event.ctrlKey && event.key === "1") {
        event.preventDefault();
        navigate("discover");
      }
      if (event.ctrlKey && event.key === "2") {
        event.preventDefault();
        navigate("foryou");
      }
      if (event.ctrlKey && event.key === "3") {
        event.preventDefault();
        navigate("library");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  useEffect(() => {
    if (!selected) {
      setDetails(null);
      return;
    }
    const key = titleKey(selected);
    let cancelled = false;
    let filling = false;
    const resolved = new Set<string>();
    const retryAt = new Map<string, number>();
    const loadDetails = async (): Promise<void> => {
      try {
        const movie = await window.api.movie(
          selected.imdbId,
          selected.mediaType,
        );
        if (!cancelled) {
          setDetails(movie);
          if (movie) detailsCache.current.set(key, movie);
        }
      } catch {
        if (!cancelled) setDetails(null);
      }
    };
    setDetails(detailsCache.current.get(key) ?? null);
    void loadDetails();
    const fill = async (): Promise<void> => {
      if (cancelled || filling) return;
      const ids = mediaIdsToFill({
        ids: [selected.imdbId],
        resolved,
        retryAt,
        now: Date.now(),
      });
      if (!ids.length) return;
      filling = true;
      retryAt.set(selected.imdbId, Date.now() + MEDIA_RETRY_MS);
      try {
        const rows = await window.api.fillMedia(ids);
        if (mediaFillSettled(rows[0])) resolved.add(selected.imdbId);
        if (!cancelled) await loadDetails();
      } catch {
        /* Existing detail remains available while metadata retries. */
      } finally {
        filling = false;
      }
    };
    void fill();
    const unsubscribe = window.api.onCatalogStatus((status) => {
      const completed = status.tmdbHydration?.completedIds ?? [];
      if (!completed.includes(selected.imdbId)) return;
      clearPendingRetries(retryAt, completed, resolved);
      detailsCache.current.delete(key);
      void loadDetails();
      void fill();
    });
    const timer = window.setInterval(() => void fill(), MEDIA_RETRY_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [selected]);

  async function saveSettings(patch: Partial<Settings>): Promise<void> {
    const previousUrl = settings.catalogApiUrl;
    const next = await window.api.setSettings(patch);
    setSettings(next);
    setMediaProxyOrigin(next.catalogApiUrl);
    applyAppearance(next);
    setError("");
    if (isAppearanceOnlyPatch(patch)) return;
    if (next.catalogApiUrl !== previousUrl) {
      setBooting(true);
      return;
    }
    await refresh();
  }

  async function upsert(
    movie: MovieSummary,
    status: LibraryEntry["status"],
    rating?: number,
  ): Promise<void> {
    if (libraryActing.current) return;
    libraryActing.current = true;
    setLibraryBusy(true);
    setError("");
    try {
      const next = await window.api.upsertLibrary({ movie, status, rating });
      setLibrary(next);
      if (undoEntry?.imdbId === movie.imdbId) setUndoEntry(null);
      setNotice(
        rating != null
          ? `Rated ${movie.title} ${rating} out of 10.`
          : `${movie.title} saved as ${status}.`,
      );
      setProfile(await window.api.profile().catch(() => profile));
    } catch {
      setError(
        "Could not save this title. Check the catalogue service and try again.",
      );
    } finally {
      libraryActing.current = false;
      setLibraryBusy(false);
    }
  }

  async function remove(
    id: string,
    mediaType: LibraryEntry["mediaType"],
  ): Promise<void> {
    if (libraryActing.current) return;
    const entry = library.find(
      (row) => titleKey(row) === titleKey({ imdbId: id }),
    );
    if (!entry) return;
    libraryActing.current = true;
    setLibraryBusy(true);
    setError("");
    try {
      setLibrary(await window.api.removeLibrary(id, mediaType));
      setUndoEntry(entry);
      setNotice(`${entry.title} removed from your library.`);
      setProfile(await window.api.profile().catch(() => profile));
    } catch {
      setError(
        "Could not remove this title. Check the catalogue service and try again.",
      );
    } finally {
      libraryActing.current = false;
      setLibraryBusy(false);
    }
  }

  async function undoRemove(): Promise<void> {
    if (!undoEntry || libraryActing.current) return;
    const entry = undoEntry;
    libraryActing.current = true;
    setLibraryBusy(true);
    setError("");
    try {
      setLibrary(
        await window.api.upsertLibrary({
          movie: libraryMovie(entry),
          status: entry.status,
          rating: entry.rating,
          ratedAt: entry.ratedAt,
        }),
      );
      setUndoEntry(null);
      setNotice(`${entry.title} restored to your library.`);
      setProfile(await window.api.profile().catch(() => profile));
    } catch {
      setError(
        "Could not restore this title. Check the catalogue service, then select Undo again.",
      );
    } finally {
      libraryActing.current = false;
      setLibraryBusy(false);
    }
  }

  const catalogBusy = isCatalogUiBlocked(catalogStatus);
  const catalogFailed = catalogStatus?.phase === "error";
  const discoverLayout = view === "discover" && !booting && !catalogBusy;
  const forYouLayout = view === "foryou" && !booting && !catalogBusy;
  const libraryLayout = view === "library" && !booting && !catalogBusy;

  const inspector = (
    <Inspector
      movie={selected}
      details={details}
      entry={library.find(
        (e) => selected && titleKey(e) === titleKey(selected),
      )}
      match={
        "match" in (selected ?? {})
          ? (selected as { match?: number }).match
          : null
      }
      docked={!discoverLayout}
      busy={libraryBusy}
      genreMap={genreMap}
      creditsReady={catalogStatus?.creditsReady !== false}
      creditsFailed={catalogStatus?.creditsFailed === true}
      onUpsert={upsert}
      onRemove={remove}
    />
  );

  return (
    <div className="grid h-full grid-rows-[48px_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-14 focus:left-4 focus:z-50 focus:rounded-control focus:border focus:border-control focus:bg-raised focus:px-4 focus:py-3 focus:text-ink"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to Content
      </a>
      <TopBar
        view={view}
        onNavigate={navigate}
        query={filters.query}
        queryRef={queryInput}
        catalogStatus={catalogStatus}
        onQueryChange={(query) => {
          setFilters((current) => ({ ...current, query, page: 1 }));
          if (view !== "discover") navigate("discover");
        }}
      />
      <div className="min-h-0">
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "relative h-full min-h-0 min-w-0",
            discoverLayout && "flex flex-col overflow-hidden p-0",
            forYouLayout && "flex flex-col overflow-hidden p-0",
            libraryLayout && "flex flex-col overflow-hidden px-6 pt-6 pb-4",
            !discoverLayout &&
              !forYouLayout &&
              !libraryLayout &&
              "overflow-auto px-6 pt-6 pb-10",
          )}
        >
          {error ? (
            <div
              role="alert"
              className={cn(
                "mb-4 rounded-control border border-danger bg-transparent px-3 py-2.5 text-[13px] text-danger",
                (discoverLayout || forYouLayout) && "shrink-0",
                (discoverLayout || forYouLayout) && "mx-6 mt-4 mb-0",
              )}
            >
              {error}
            </div>
          ) : null}
          <div
            className={cn(
              "shrink-0",
              (discoverLayout || forYouLayout) && "mx-6",
            )}
          >
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={notice ? "my-2 text-[13px] text-muted" : "sr-only"}
            >
              {notice}
            </p>
            {undoEntry && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  ref={undoButton}
                  type="button"
                  className={btn("primary", "compact")}
                  disabled={libraryBusy}
                  onClick={() => void undoRemove()}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className={btn("ghost", "compact")}
                  disabled={libraryBusy}
                  onClick={() => {
                    setUndoEntry(null);
                    setNotice("");
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
          {view === "settings" ? (
            <SettingsView
              settings={settings}
              catalogStatus={catalogStatus}
              onSave={saveSettings}
              onLibraryChange={setLibrary}
              onError={setError}
              onDirtyChange={onSettingsDirty}
            />
          ) : catalogFailed ? (
            <section className="mx-auto my-[8vh] flex max-w-140 flex-col gap-2 px-0 py-2">
              <span className="kicker text-danger">Catalogue failed</span>
              <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-title">
                The catalogue is not ready
              </h1>
              <p className="m-0 text-sm leading-description text-muted">
                {catalogStatus?.error ||
                  catalogStatus?.message ||
                  "The local catalogue could not start."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className={btn("primary")}
                  onClick={() => {
                    setError("");
                    setBooting(true);
                    void window.api.retryCatalog();
                  }}
                >
                  Try again
                </button>
                <button className={btn()} onClick={() => navigate("settings")}>
                  Open Settings
                </button>
              </div>
            </section>
          ) : booting || catalogBusy ? (
            <CatalogLoader
              label={catalogStatus?.message ?? "Loading your ranking studio…"}
              download={catalogStatus?.download}
              hydration={catalogStatus?.tmdbHydration}
              detail={catalogLoaderDetail(catalogStatus)}
            />
          ) : view === "discover" ? (
            <Discover
              library={library}
              libraryRevision={libraryRevision}
              rankingMode={settings.rankingMode}
              filters={filters}
              setFilters={setFilters}
              genres={genres}
              selectedId={selected ? titleKey(selected) : null}
              onOpen={setSelected}
              onError={setError}
              inspector={inspector}
            />
          ) : view === "foryou" ? (
            <ForYou
              library={library}
              libraryRevision={libraryRevision}
              profile={profile}
              genreMap={genreMap}
              selectedId={selected ? titleKey(selected) : null}
              onOpen={setSelected}
              onError={setError}
              rankingMode={settings.rankingMode}
              onRankingModeChange={(rankingMode) =>
                void saveSettings({ rankingMode }).catch((err: Error) =>
                  setError(err.message),
                )
              }
            />
          ) : view === "library" ? (
            <Library
              library={library}
              genreMap={genreMap}
              selectedId={selected ? titleKey(selected) : null}
              onOpen={setSelected}
              onRemove={remove}
              busy={libraryBusy}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
