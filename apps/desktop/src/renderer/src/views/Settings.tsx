import { useEffect, useState, type JSX } from "react";
import {
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
  parseAccentColor,
} from "../../../shared/appearance";
import type {
  CatalogStatus,
  ImportProgress,
  LibraryEntry,
  RankingMode,
  Settings,
  ThemeMode,
} from "../../../shared/types";
import Select from "../components/select";
import { applyAppearance } from "../lib/appearance";
import { cn } from "../lib/cn";
import { btn } from "../lib/ui";

const RANKING_OPTIONS = [
  { value: "balanced", label: "Balanced — taste plus a little recent context" },
  { value: "same", label: "More of the same — lean into your current streak" },
  { value: "diverse", label: "Surprise me — downrank genres you just watched" },
] as const;

export default function SettingsView({
  settings,
  catalogStatus,
  onSave,
  onLibraryChange,
  onError,
}: {
  settings: Settings;
  catalogStatus: CatalogStatus | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onLibraryChange: (library: LibraryEntry[]) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [catalogApiUrl, setCatalogApiUrl] = useState(settings.catalogApiUrl);
  const [region, setRegion] = useState(settings.region);
  const [mode, setMode] = useState<RankingMode>(settings.rankingMode);
  const [imdbApiUrl, setImdbApiUrl] = useState(settings.imdbApiUrl);
  const [tmdbApiKey, setTmdbApiKey] = useState(settings.tmdbApiKey);
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [accentDraft, setAccentDraft] = useState(settings.accentColor);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCatalogApiUrl(settings.catalogApiUrl);
    setRegion(settings.region);
    setMode(settings.rankingMode);
    setImdbApiUrl(settings.imdbApiUrl);
    setTmdbApiKey(settings.tmdbApiKey);
    setThemeMode(settings.themeMode);
    setAccentColor(settings.accentColor);
    setAccentDraft(settings.accentColor);
  }, [settings]);

  useEffect(() => {
    return window.api.onImportProgress(setProgress);
  }, []);

  function commitAppearance(nextMode: ThemeMode, nextAccent: string): void {
    const accent = normalizeAccentColor(nextAccent);
    setThemeMode(nextMode);
    setAccentColor(accent);
    setAccentDraft(accent);
    applyAppearance({ themeMode: nextMode, accentColor: accent });
    void onSave({ themeMode: nextMode, accentColor: accent });
  }

  async function save(): Promise<void> {
    onError("");
    await onSave({
      catalogApiUrl: catalogApiUrl.trim(),
      region,
      rankingMode: mode,
      imdbApiUrl: imdbApiUrl.trim(),
      tmdbApiKey: tmdbApiKey.trim(),
      themeMode,
      accentColor,
    });
  }

  async function rebuildCatalog(): Promise<void> {
    if (
      !confirm(
        "Rebuild the catalog from IMDb’s non-commercial datasets? This can take several minutes. Dumps that still match IMDb (ETag, size, gzip) are not downloaded again. Your ratings, watchlist, and skips are kept.",
      )
    ) {
      return;
    }
    onError("");
    await window.api.rebuildCatalog();
  }

  async function importCsv(): Promise<void> {
    setBusy(true);
    onError("");
    try {
      const result = await window.api.importImdbCsv();
      setProgress(result);
      onLibraryChange(await window.api.listLibrary());
    } catch (error) {
      onError(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h2 className="m-0 text-[28px] font-650 tracking-title">Settings</h2>
          <p className="mt-1.5 mb-0 max-w-[640px] text-[13px] leading-[1.45] text-muted">
            Choose a look, connect the catalog, tune how watch streaks affect
            ranking, and import your IMDb history. Rebuild the catalog from
            this page when you want a fresh copy of IMDb’s datasets.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch inspect:grid-cols-2 inspect:gap-0">
        <div className="min-w-0 border border-line p-[18px] inspect:col-span-2">
          <h3 className="kicker">Appearance</h3>
          <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
            <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
              Theme
              <div
                className="flex overflow-hidden rounded-app border border-line"
                role="radiogroup"
                aria-label="Theme"
              >
                {(["dark", "light"] as const).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    role="radio"
                    aria-checked={themeMode === modeOption}
                    className={cn(
                      "flex-1 border-0 px-3 py-2.5 text-[13px] font-semibold",
                      themeMode === modeOption
                        ? "bg-accent-soft text-accent"
                        : "bg-transparent text-muted hover:bg-wash-6 hover:text-ink",
                    )}
                    onClick={() => commitAppearance(modeOption, accentColor)}
                  >
                    {modeOption === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </label>
            <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
              Accent
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Accent color picker"
                  value={parseAccentColor(accentColor) ?? DEFAULT_ACCENT_COLOR}
                  onChange={(event) =>
                    commitAppearance(themeMode, event.target.value)
                  }
                  className="size-10.5 shrink-0 cursor-pointer rounded-app border border-line bg-transparent p-1 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[7px] [&::-webkit-color-swatch]:border-0"
                />
                <input
                  type="text"
                  value={accentDraft}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Accent color hex"
                  placeholder={DEFAULT_ACCENT_COLOR}
                  onChange={(event) => {
                    const next = event.target.value;
                    setAccentDraft(next);
                    const parsed = parseAccentColor(next);
                    if (parsed) commitAppearance(themeMode, parsed);
                  }}
                  onBlur={() =>
                    setAccentDraft(parseAccentColor(accentDraft) ?? accentColor)
                  }
                />
              </div>
            </label>
          </div>
          <p className="text-xs leading-[1.45] text-muted tabular">
            Theme and accent apply immediately on this PC.
          </p>
        </div>
        <div className="min-w-0 border border-t-0 border-line p-[18px]">
          <h3 className="kicker">Catalog access</h3>
          <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
            Catalog API URL
            <input
              type="url"
              value={catalogApiUrl}
              onChange={(e) => setCatalogApiUrl(e.target.value)}
              placeholder="http://127.0.0.1:3847"
            />
          </label>
          <p className="text-xs leading-[1.45] text-muted tabular">
            Built automatically on first launch from IMDb’s non-commercial
            datasets. Later launches reuse the local SQLite catalog. Default
            address is http://127.0.0.1:3847.
          </p>
          <p className="text-xs leading-[1.45] text-muted tabular">
            {catalogSummary(catalogStatus)}
          </p>
          <button
            className={cn(btn(), "mb-3")}
            disabled={catalogStatus?.phase === "building"}
            onClick={() => void rebuildCatalog()}
          >
            Rebuild catalog
          </button>
          <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
            TMDB API key
            <input
              type="password"
              value={tmdbApiKey}
              onChange={(e) => setTmdbApiKey(e.target.value)}
              placeholder="Needed for poster images"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="text-xs leading-[1.45] text-muted tabular">
            IMDb’s dumps don’t include posters. IMDBrain looks them up on TMDB
            in the background after the catalog is ready. Without a key,
            titles show placeholders.
          </p>
          <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
            IMDb ratings API
            <input
              type="url"
              value={imdbApiUrl}
              onChange={(e) => setImdbApiUrl(e.target.value)}
              placeholder="http://127.0.0.1:3847"
            />
          </label>
          <p className="text-xs leading-[1.45] text-muted tabular">
            Used for local rating lookups. It normally matches the catalog URL.
          </p>
          <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
            Region
            <input
              type="text"
              value={region}
              maxLength={2}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
            />
          </label>
          <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
            Ranking mode
            <Select
              value={mode}
              ariaLabel="Ranking mode"
              options={RANKING_OPTIONS}
              onChange={(next) => setMode(next as RankingMode)}
            />
          </label>
          <button className={btn("primary")} onClick={() => void save()}>
            Save settings
          </button>
        </div>
        <div className="min-w-0 border border-t-0 border-line p-[18px] inspect:border-l-0">
          <h3 className="kicker">IMDb ratings import</h3>
          <p className="text-xs leading-[1.45] text-muted tabular">
            On IMDb: Ratings → Export. Choose the CSV here. IMDBrain looks up
            each `tt` ID, stores the movie as watched, and rebuilds your taste
            model.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              className={btn("primary")}
              disabled={busy}
              onClick={() => void importCsv()}
            >
              {busy ? "Importing…" : "Import ratings.csv"}
            </button>
            <button
              className={btn()}
              onClick={async () => {
                await window.api.exportLibrary();
              }}
            >
              Export library JSON
            </button>
            <button
              className={btn("danger")}
              onClick={async () => {
                if (confirm("Clear local ratings, watchlist, and skips?")) {
                  onLibraryChange(await window.api.clearLibrary());
                }
              }}
            >
              Clear library
            </button>
          </div>
          {progress ? (
            <div>
              <div className="my-2.5 h-2 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: progress.total
                      ? `${(progress.current / progress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="text-xs leading-[1.45] text-muted tabular">
                {progress.current}/{progress.total} {progress.title} · imported{" "}
                {progress.imported} · skipped {progress.skipped} · errors{" "}
                {progress.errors}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function catalogSummary(status: CatalogStatus | null): string {
  if (!status) return "Catalog status is not available yet.";
  const count =
    status.titleCount > 0
      ? `${status.titleCount.toLocaleString()} titles`
      : "no titles yet";
  if (!status.builtAt) return `Local catalog: ${count}.`;
  const built = new Date(status.builtAt);
  if (Number.isNaN(built.getTime())) return `Local catalog: ${count}.`;
  return `Local catalog: ${count}, last built ${built.toLocaleString()}.`;
}
