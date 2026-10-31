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
  setMediaProxyOrigin,
  titleKey,
} from "../../shared/types";
import CatalogLoader from "./components/catalog-loader";
import SetupScreen from "./components/setup-screen";
import Inspector from "./components/inspector";
import { useNotify } from "./components/notifications";
import TopBar from "./components/top-bar";
import { applyAppearance } from "./lib/appearance";
import {
  catalogLoaderDetail,
  isCatalogUiBlocked,
  sameCatalogView,
} from "./lib/catalog-busy";
import {
  MEDIA_RETRY_MS,
  clearPendingRetries,
  mediaFillSettled,
  mediaIdsToFill,
} from "./lib/use-visible-media";
import { cn } from "./lib/cn";
import { pollWhileVisible } from "./lib/poll-while-visible";
import { listSearchHistory } from "./lib/search-history-store";
import { btn, pageTitleClass } from "./lib/ui";
import { libraryMovie } from "./lib/library-movie";
import Discover from "./views/Discover";
import ForYou from "./views/ForYou";
import Library from "./views/Library";
import SettingsView from "./views/Settings";
import { loadTmdbHealth } from "./lib/tmdb-health";

/** Title details kept for instant reopening, most recently opened last. */
const DETAILS_CACHE_LIMIT = 60;

export default function App(): JSX.Element {
  const [view, setView] = useState<AppView>("discover");
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [genres, setGenres] = useState<Genre[]>([]);
  const [library, setLibraryState] = useState<LibraryEntry[]>([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>(defaultFilters);
  const [selected, setSelected] = useState<MovieSummary | null>(null);
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [error, setError] = useState("");
  // Confirmations are announced to screen readers only; destructive actions
  // raise a notification (bottom right) that can undo them, and the
  // notification region announces those itself.
  const [notice, setNotice] = useState("");
  const notify = useNotify();
  const [libraryBusy, setLibraryBusy] = useState(false);
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
      // A title picked in one view rarely belongs to the next one.
      setSelected(null);
    },
    [view],
  );

  // A library action can unmount the control that had focus (Remove, say);
  // focus then returns to the page rather than the document body.
  const wasLibraryBusy = useRef(false);
  useEffect(() => {
    const finished = wasLibraryBusy.current && !libraryBusy;
    wasLibraryBusy.current = libraryBusy;
    if (finished && document.activeElement === document.body)
      document.getElementById("main-content")?.focus();
  }, [libraryBusy]);
  const [booting, setBooting] = useState(true);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(
    null,
  );
  const detailsCache = useRef(new Map<string, MovieDetails>());
  const cacheDetails = useCallback((key: string, movie: MovieDetails) => {
    const cache = detailsCache.current;
    cache.delete(key);
    cache.set(key, movie);
    // Oldest first: a long browse keeps only the titles opened lately.
    while (cache.size > DETAILS_CACHE_LIMIT)
      cache.delete(cache.keys().next().value as string);
  }, []);

  const genreMap = useMemo(
    () => new Map(genres.map((genre) => [genre.id, genre.name])),
    [genres],
  );

  // Rating titles in quick succession starts overlapping reloads; only the
  // newest may land, and none holds up the next library action.
  const profileRequest = useRef(0);
  const refreshProfile = useCallback(async () => {
    const request = ++profileRequest.current;
    const next = await window.api.profile().catch(() => null);
    if (next && request === profileRequest.current) setProfile(next);
  }, []);
  // The only way to replace the library: the taste profile is built from it,
  // so every write reloads the profile too.
  const changeLibrary = useCallback(
    (next: LibraryEntry[]) => {
      setLibraryState(next);
      setLibraryRevision((revision) => revision + 1);
      void refreshProfile();
    },
    [refreshProfile],
  );

  const refresh = useCallback(async () => {
    const [nextSettings, nextLibrary] = await Promise.all([
      window.api.getSettings(),
      window.api.listLibrary(),
    ]);
    setSettings(nextSettings);
    setMediaProxyOrigin(nextSettings.catalogApiUrl);
    changeLibrary(nextLibrary);
    setGenres(await window.api.genres().catch(() => [] as Genre[]));
  }, [changeLibrary]);

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
    return window.api.onCatalogStatus((next) =>
      setCatalogStatus((current) =>
        current && sameCatalogView(current, next) ? current : next,
      ),
    );
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
          if (movie) cacheDetails(key, movie);
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
    let creditsReady: boolean | undefined;
    const unsubscribe = window.api.onCatalogStatus((status) => {
      // Cast and directors load after browsing opens; an open title picks
      // them up as soon as they land.
      const creditsArrived =
        creditsReady === false && status.creditsReady === true;
      creditsReady = status.creditsReady;
      const completed = status.tmdbHydration?.completedIds ?? [];
      if (creditsArrived) {
        detailsCache.current.clear();
        void loadDetails();
      }
      if (!completed.includes(selected.imdbId)) return;
      clearPendingRetries(retryAt, completed, resolved);
      detailsCache.current.delete(key);
      void loadDetails();
      void fill();
    });
    // Fills now, then retries while the window is shown.
    const stopPolling = pollWhileVisible(() => void fill(), MEDIA_RETRY_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      stopPolling();
    };
  }, [selected, cacheDetails]);

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
      changeLibrary(next);
      setNotice(
        rating != null
          ? `Rated ${movie.title} ${rating} out of 10.`
          : `${movie.title} saved as ${status}.`,
      );
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
      changeLibrary(await window.api.removeLibrary(id, mediaType));
      setNotice(`${entry.title} removed from your library.`);
      notify({
        tone: "success",
        message: `${entry.title} removed from your library.`,
        undo: () => undoRemove(entry),
      });
    } catch {
      setError(
        "Could not remove this title. Check the catalogue service and try again.",
      );
    } finally {
      libraryActing.current = false;
      setLibraryBusy(false);
    }
  }

  async function undoRemove(entry: LibraryEntry): Promise<void> {
    if (libraryActing.current) return;
    libraryActing.current = true;
    setLibraryBusy(true);
    setError("");
    try {
      changeLibrary(
        await window.api.upsertLibrary({
          movie: libraryMovie(entry),
          status: entry.status,
          rating: entry.rating,
          ratedAt: entry.ratedAt,
        }),
      );
      setNotice(`${entry.title} restored to your library.`);
      notify({
        tone: "success",
        message: `${entry.title} restored to your library.`,
      });
    } catch {
      notify({
        tone: "error",
        message: `Could not restore ${entry.title}. Check the catalogue service and try again.`,
        undo: () => undoRemove(entry),
      });
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

  const renderInspector = (onClose?: () => void) => (
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
      busy={libraryBusy}
      tasteReady={profile?.ready === true}
      genreMap={genreMap}
      creditsReady={catalogStatus?.creditsReady !== false}
      creditsFailed={catalogStatus?.creditsFailed === true}
      onUpsert={upsert}
      onRemove={remove}
      onClose={onClose}
    />
  );
  // Discover always shows the panel; For You and Library show it while a
  // title is open, with a way back to what it replaced.
  const closableInspector = selected
    ? renderInspector(() => setSelected(null))
    : null;

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
            libraryLayout && "flex flex-col overflow-hidden p-0",
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
                "rounded-control bg-danger/12 px-3 py-2.5 text-ui text-danger",
                discoverLayout || forYouLayout || libraryLayout
                  ? "mx-6 mt-4 shrink-0"
                  : "mb-4",
              )}
            >
              {error}
            </div>
          ) : null}
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {notice}
          </p>
          {view === "settings" ? (
            <SettingsView
              settings={settings}
              catalogStatus={catalogStatus}
              onSave={saveSettings}
              onLibraryChange={changeLibrary}
              onError={setError}
              onDirtyChange={onSettingsDirty}
            />
          ) : catalogFailed ? (
            <section className="mx-auto my-[8vh] flex max-w-140 flex-col gap-2 px-0 py-2">
              <span className="kicker text-danger">Catalogue failed</span>
              <h1 className={pageTitleClass}>The catalogue is not ready</h1>
              <p className="m-0 text-sm leading-description text-muted">
                {catalogStatus?.error ||
                  catalogStatus?.message ||
                  "The local catalogue could not start."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btn("primary")}
                  onClick={() => {
                    setError("");
                    setBooting(true);
                    void window.api.retryCatalog();
                  }}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className={btn()}
                  onClick={() => navigate("settings")}
                >
                  Open Settings
                </button>
              </div>
            </section>
          ) : (booting || catalogBusy) && catalogStatus?.setup ? (
            <SetupScreen
              setup={catalogStatus.setup}
              rebuilding={catalogStatus.titlesReady === true}
            />
          ) : booting || catalogBusy ? (
            <CatalogLoader
              label={catalogStatus?.message ?? "Loading your ranking studio…"}
              hydration={catalogStatus?.tmdbHydration}
              detail={catalogLoaderDetail(catalogStatus)}
            />
          ) : view === "discover" ? (
            <Discover
              library={library}
              rankingMode={settings.rankingMode}
              filters={filters}
              setFilters={setFilters}
              genres={genres}
              selectedId={selected ? titleKey(selected) : null}
              onOpen={setSelected}
              onError={setError}
              inspector={renderInspector()}
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
              inspector={closableInspector}
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
              inspector={closableInspector}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
