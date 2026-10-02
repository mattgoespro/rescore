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
import CatalogLoader from "../components/catalog-loader";
import BackgroundService from "../components/background-service";
import Select from "../components/select";
import { applyAppearance } from "../lib/appearance";
import { catalogRebuildFeedback, tmdbHealthPercent } from "../lib/catalog-busy";
import { cn } from "../lib/cn";
import {
  btn,
  progressBarClass,
  progressFillClass,
  segmentedCell,
  segmentedGroup,
} from "../lib/ui";

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
  const [serviceRequired, setServiceRequired] = useState(true);
  useEffect(() => {
    void window.api.backgroundService.getStatus().then((status) => setServiceRequired(status.supported)).catch(() => undefined);
  }, []);
  const [region, setRegion] = useState(settings.region);
  const [mode, setMode] = useState<RankingMode>(settings.rankingMode);
  const [imdbApiUrl, setImdbApiUrl] = useState(settings.imdbApiUrl);
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [accentDraft, setAccentDraft] = useState(settings.accentColor);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const rebuild = catalogRebuildFeedback(catalogStatus);

  useEffect(() => {
    setCatalogApiUrl(settings.catalogApiUrl);
    setRegion(settings.region);
    setMode(settings.rankingMode);
    setImdbApiUrl(settings.imdbApiUrl);
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
      <div className="mb-5.5">
        <h2 className="m-0 text-[28px] font-650 tracking-title text-balance">
          Settings
        </h2>
        <p className="mt-1.5 mb-0 max-w-160 text-[13px] leading-[1.45] text-pretty text-muted">
          Catalog, imported ratings, and how titles are ranked.
        </p>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 inspect:grid-cols-2">
        <div className="min-w-0 border border-line p-4.5 inspect:col-span-2">
          <h3 className="kicker">Appearance</h3>
          <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
            <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
              Theme
              <div
                className={segmentedGroup("text")}
                role="radiogroup"
                aria-label="Theme"
              >
                {(["dark", "light"] as const).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    role="radio"
                    aria-checked={themeMode === modeOption}
                    className={segmentedCell(themeMode === modeOption, "text")}
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
                  className="size-10.5 shrink-0 cursor-pointer rounded-app border border-line bg-transparent p-1 [&::-webkit-color-swatch]:rounded-[7px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
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
          <p className="text-xs leading-[1.45] text-pretty text-muted">
            Theme and accent apply immediately on this PC.
          </p>
        </div>
        <div className="min-w-0 border border-line p-4.5">
          <h3 className="kicker">Catalog</h3>
          <p className="text-xs leading-[1.45] text-pretty text-muted">
            {catalogSummary(catalogStatus)}
          </p>
          <button
            className={cn(btn(), "mb-3")}
            disabled={rebuild != null}
            aria-busy={rebuild != null}
            onClick={() => void rebuildCatalog()}
          >
            {rebuild?.button ?? "Rebuild catalog"}
          </button>
          {rebuild ? (
            <div className="mb-3" role="status" aria-live="polite">
              <CatalogLoader
                layout="inline"
                label={rebuild.label}
                download={catalogStatus?.download}
              />
            </div>
          ) : null}
          <p className="text-xs leading-[1.45] text-pretty text-muted">
            Posters, synopses, and age ratings fill in from TMDb while you browse.
          </p>
          <TmdbHealth />
          <BackgroundService />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="border border-line p-4.5">
            <h3 className="kicker">Ratings import</h3>
            <p className="text-xs leading-[1.45] text-pretty text-muted">
              Export your ratings from IMDb, then choose the CSV. Imported titles
              are marked watched.
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
                <div className={cn("my-2.5", progressBarClass)}>
                  <div
                    className={progressFillClass}
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
          <div className="border border-line p-4.5">
            <h3 className="kicker">Ranking</h3>
            {!serviceRequired && (
              <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
                Catalog API URL
                <input
                  type="url"
                  value={catalogApiUrl}
                  onChange={(e) => setCatalogApiUrl(e.target.value)}
                  placeholder="http://127.0.0.1:3847"
                />
              </label>
            )}
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
            <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
              IMDb ratings API
              <input
                type="url"
                value={imdbApiUrl}
                onChange={(e) => setImdbApiUrl(e.target.value)}
                placeholder="http://127.0.0.1:3847"
              />
            </label>
            <p className="text-xs leading-[1.45] text-pretty text-muted">
              Local rating lookups. Usually the same address as the catalog.
            </p>
            <button className={btn("primary")} onClick={() => void save()}>
              Save settings
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TmdbHealth(): JSX.Element {
  const [health, setHealth] = useState<{
    total: number;
    posters: number;
    synopses: number;
    certifications: number;
  } | null>();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void window.api
        .tmdbHealth()
        .then((next) => {
          if (!cancelled) setHealth(next);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!health?.total) {
    return (
      <p className="mb-3 text-xs leading-[1.45] text-pretty text-muted">
        {health === undefined
          ? "Checking coverage…"
          : health
            ? "No titles to measure yet."
            : "Coverage is not available right now."}
      </p>
    );
  }
  const total = health.total;
  return (
    <div className="mb-3">
      <p className="mb-2 text-xs font-medium text-muted">TMDb coverage</p>
      <div className="flex flex-col gap-3">
        <HealthBar
          label="Posters"
          filled={health?.posters ?? 0}
          total={total}
        />
        <HealthBar
          label="Synopses"
          filled={health?.synopses ?? 0}
          total={total}
        />
        <HealthBar
          label="Age ratings"
          filled={health?.certifications ?? 0}
          total={total}
        />
      </div>
    </div>
  );
}

function HealthBar({
  label,
  filled,
  total,
}: {
  label: string;
  filled: number;
  total: number;
}): JSX.Element {
  const percent = tmdbHealthPercent(filled, total);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="tabular">
          {percent.label} · {filled.toLocaleString()} of{" "}
          {total.toLocaleString()}
        </span>
      </div>
      <div
        className={progressBarClass}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent.value}
        aria-valuetext={`${filled.toLocaleString()} of ${total.toLocaleString()}`}
      >
        <div
          className={progressFillClass}
          style={{ width: `${percent.width}%` }}
        />
      </div>
    </div>
  );
}

function catalogSummary(status: CatalogStatus | null): string {
  if (!status) return "Catalog status is not available yet.";
  const count =
    status.titleCount > 0
      ? `${status.titleCount.toLocaleString()} titles`
      : "no titles yet";
  const updateNotice = status.titlesUpdateAvailable
    ? " A newer IMDb dump is available. Rebuild when you want it."
    : "";
  if (!status.builtAt) return `Local catalog: ${count}.${updateNotice}`;
  const built = new Date(status.builtAt);
  if (Number.isNaN(built.getTime()))
    return `Local catalog: ${count}.${updateNotice}`;
  return `Local catalog: ${count}, last built ${built.toLocaleString()}.${updateNotice}`;
}
