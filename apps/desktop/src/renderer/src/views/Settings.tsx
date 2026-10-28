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
import { useNotify } from "../components/notifications";
import BackgroundService from "../components/background-service";
import Select from "../components/select";
import { applyAppearance } from "../lib/appearance";
import { catalogRebuildFeedback, tmdbHealthPercent } from "../lib/catalog-busy";
import {
  lastTmdbHealth,
  loadTmdbHealth,
  type TmdbHealthReading,
} from "../lib/tmdb-health";
import { cn } from "../lib/cn";
import {
  validateRankingSettings,
  type SettingsErrors,
} from "../lib/settings-validation";
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
  onDirtyChange,
}: {
  settings: Settings;
  catalogStatus: CatalogStatus | null;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onLibraryChange: (library: LibraryEntry[]) => void;
  onError: (message: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}): JSX.Element {
  const notify = useNotify();
  const [catalogApiUrl, setCatalogApiUrl] = useState(settings.catalogApiUrl);
  const [serviceRequired, setServiceRequired] = useState(true);
  useEffect(() => {
    void window.api.backgroundService
      .getStatus()
      .then((status) => setServiceRequired(status.supported))
      .catch(() => undefined);
  }, []);
  const [mode, setMode] = useState<RankingMode>(settings.rankingMode);
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [accentDraft, setAccentDraft] = useState(settings.accentColor);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SettingsErrors>({});
  const rebuild = catalogRebuildFeedback(catalogStatus);
  const dirty =
    mode !== settings.rankingMode ||
    (!serviceRequired && catalogApiUrl !== settings.catalogApiUrl);

  // Appearance saves must not replace unrelated edits in the ranking form.
  useEffect(
    () => setCatalogApiUrl(settings.catalogApiUrl),
    [settings.catalogApiUrl],
  );
  useEffect(() => setMode(settings.rankingMode), [settings.rankingMode]);
  useEffect(() => {
    setThemeMode(settings.themeMode);
    setAccentColor(settings.accentColor);
    setAccentDraft(settings.accentColor);
  }, [settings.themeMode, settings.accentColor]);

  useEffect(() => {
    onDirtyChange(dirty || saving || appearanceBusy);
    return () => onDirtyChange(false);
  }, [dirty, saving, appearanceBusy, onDirtyChange]);

  useEffect(() => {
    if (!dirty && !saving && !appearanceBusy) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving, appearanceBusy]);

  useEffect(() => {
    return window.api.onImportProgress(setProgress);
  }, []);

  async function commitAppearance(
    nextMode: ThemeMode,
    nextAccent: string,
  ): Promise<void> {
    if (appearanceBusy) return;
    const accent = normalizeAccentColor(nextAccent);
    setAppearanceBusy(true);
    setFeedback("");
    setThemeMode(nextMode);
    setAccentColor(accent);
    setAccentDraft(accent);
    applyAppearance({ themeMode: nextMode, accentColor: accent });
    try {
      await onSave({ themeMode: nextMode, accentColor: accent });
      setFeedback("Appearance saved.");
    } catch {
      applyAppearance(settings);
      setThemeMode(settings.themeMode);
      setAccentColor(settings.accentColor);
      setAccentDraft(settings.accentColor);
      onError(
        "Could not save appearance. Try changing the theme or accent again.",
      );
    } finally {
      setAppearanceBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    onError("");
    setFeedback("");
    setSaveError("");
    const errors = validateRankingSettings({ catalogApiUrl }, serviceRequired);
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById(`settings-${first}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...(!serviceRequired ? { catalogApiUrl: catalogApiUrl.trim() } : {}),
        rankingMode: mode,
      });
      setFeedback("Settings saved.");
    } catch {
      setSaveError(
        "Could not save settings. Check that the catalogue is running, then try Save Settings again.",
      );
    } finally {
      setSaving(false);
    }
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
    try {
      await window.api.rebuildCatalog();
    } catch {
      onError(
        "Could not rebuild the catalogue. Check the service in Settings, then try again.",
      );
    }
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
      <div className="mb-6">
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-title text-balance">
          Settings
        </h1>
        <p className="mt-1 mb-0 max-w-[60ch] text-sm leading-copy text-pretty text-muted">
          Catalog, imported ratings, and how titles are ranked.
        </p>
      </div>
      <p
        className="my-2 text-[13px] text-muted"
        role="status"
        aria-live="polite"
      >
        {feedback}
      </p>
      <div className="grid max-w-300 grid-cols-1 items-start gap-4 inspect:grid-cols-2">
        <div className="min-w-0 rounded-app border border-line bg-rail p-5 inspect:col-span-2">
          <h2 className="kicker">Appearance</h2>
          <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
            <fieldset
              disabled={appearanceBusy}
              className="m-0 min-w-0 border-0 p-0"
            >
              <legend className="mb-2 text-[13px] text-muted">Theme</legend>
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
                    tabIndex={themeMode === modeOption ? 0 : -1}
                    className={segmentedCell(themeMode === modeOption, "text")}
                    onClick={() =>
                      void commitAppearance(modeOption, accentColor)
                    }
                    onKeyDown={(event) => {
                      if (
                        ![
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                        ].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "dark"
                          : event.key === "End"
                            ? "light"
                            : modeOption === "dark"
                              ? "light"
                              : "dark";
                      const buttons =
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          "button",
                        );
                      buttons?.[next === "dark" ? 0 : 1]?.focus();
                      void commitAppearance(next, accentColor);
                    }}
                  >
                    {modeOption === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset
              disabled={appearanceBusy}
              className="m-0 min-w-0 border-0 p-0"
            >
              <legend className="mb-2 text-[13px] text-muted">Accent</legend>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="accentColor"
                  aria-label="Accent color picker"
                  value={parseAccentColor(accentColor) ?? DEFAULT_ACCENT_COLOR}
                  onChange={(event) =>
                    void commitAppearance(themeMode, event.target.value)
                  }
                  className="size-9 shrink-0 cursor-pointer rounded-control border border-transparent bg-wash-6 p-1 [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                />
                <input
                  type="text"
                  name="accentHex"
                  autoComplete="off"
                  value={accentDraft}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label="Accent color hex"
                  placeholder={DEFAULT_ACCENT_COLOR}
                  onChange={(event) => setAccentDraft(event.target.value)}
                  onBlur={() => {
                    const parsed = parseAccentColor(accentDraft);
                    if (parsed && parsed !== accentColor)
                      void commitAppearance(themeMode, parsed);
                    else setAccentDraft(accentColor);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
            </fieldset>
          </div>
          <p className="text-[13px] leading-copy text-pretty text-muted not-empty:mt-2">
            Theme and accent apply immediately on this PC.
          </p>
        </div>
        <div className="min-w-0 rounded-app border border-line bg-rail p-5">
          <h2 className="kicker">Catalog</h2>
          <p className="text-[13px] leading-copy text-pretty text-muted not-empty:mt-2">
            {catalogSummary(catalogStatus)}
          </p>
          <button
            className={cn(btn("small"), "mt-3 mb-4")}
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
          <p className="text-[13px] leading-copy text-pretty text-muted not-empty:mt-2">
            Posters, synopses, and age ratings fill in from TMDb while you
            browse.
          </p>
          <TmdbHealth apiUrl={settings.catalogApiUrl} />
          <BackgroundService />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-app border border-line bg-rail p-5">
            <h2 className="kicker">Ratings import</h2>
            <p className="text-[13px] leading-copy text-pretty text-muted not-empty:mt-2">
              Export your ratings from IMDb, then choose the CSV. Imported
              titles are marked watched.
            </p>
            <div className="my-3 flex flex-wrap gap-2.5">
              <button
                className={btn("primary", "small")}
                disabled={busy}
                aria-busy={busy}
                onClick={() => void importCsv()}
              >
                {busy ? "Importing…" : "Import ratings.csv"}
              </button>
              <button
                className={btn("small")}
                onClick={async () => {
                  try {
                    const result = await window.api.exportLibrary();
                    if (result.ok) setFeedback("Library exported.");
                  } catch {
                    onError(
                      "Could not export the library. Choose an accessible folder and try again.",
                    );
                  }
                }}
              >
                Export library JSON
              </button>
              <button
                className={btn("danger", "small")}
                onClick={async () => {
                  if (confirm("Clear local ratings, watchlist, and skips?")) {
                    try {
                      onLibraryChange(await window.api.clearLibrary());
                      notify({ tone: "success", message: "Library cleared." });
                    } catch {
                      onError(
                        "Could not clear the library. Check the catalogue service and try again.",
                      );
                    }
                  }
                }}
              >
                Clear library
              </button>
            </div>
            {progress ? (
              <div>
                <div
                  className={cn("my-2.5", progressBarClass)}
                  role="progressbar"
                  aria-label="Ratings import"
                  aria-valuemin={0}
                  aria-valuemax={progress.total || 1}
                  aria-valuenow={progress.current}
                >
                  <div
                    className={progressFillClass}
                    style={{
                      width: progress.total
                        ? `${(progress.current / progress.total) * 100}%`
                        : "0%",
                    }}
                  />
                </div>
                <div
                  className="text-xs leading-copy text-muted tabular"
                  role="status"
                  aria-live="polite"
                >
                  {progress.current}/{progress.total} {progress.title} ·
                  imported {progress.imported} · skipped {progress.skipped} ·
                  errors {progress.errors}
                </div>
              </div>
            ) : null}
          </div>
          <form
            className="rounded-app border border-line bg-rail p-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h2 className="kicker">Ranking</h2>
            {!serviceRequired && (
              <label className="mb-1 flex min-w-0 flex-col gap-2 text-[13px] text-muted">
                Catalog API URL
                <input
                  type="url"
                  id="settings-catalogApiUrl"
                  name="catalogApiUrl"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saving}
                  aria-invalid={!!fieldErrors.catalogApiUrl}
                  aria-describedby={
                    fieldErrors.catalogApiUrl ? "catalog-url-error" : undefined
                  }
                  value={catalogApiUrl}
                  onChange={(e) => setCatalogApiUrl(e.target.value)}
                  placeholder="http://127.0.0.1:3847…"
                />
              </label>
            )}
            {!serviceRequired && fieldErrors.catalogApiUrl && (
              <p id="catalog-url-error" className="mt-1 text-xs text-danger-fg">
                {fieldErrors.catalogApiUrl}
              </p>
            )}
            <label className="mb-1 flex min-w-0 flex-col gap-2 text-[13px] text-muted">
              Ranking mode
              <Select
                value={mode}
                ariaLabel="Ranking mode"
                disabled={saving}
                options={RANKING_OPTIONS}
                onChange={(next) => setMode(next as RankingMode)}
              />
            </label>
            <p role="alert" className="text-xs text-danger-fg not-empty:mt-2">
              {saveError}
            </p>
            <button
              type="submit"
              className={cn(btn("primary", "small"), "mt-4")}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function TmdbHealth({ apiUrl }: { apiUrl: string }): JSX.Element {
  const [health, setHealth] = useState<TmdbHealthReading | null | undefined>(
    lastTmdbHealth,
  );

  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadTmdbHealth()
        .then((next) => {
          if (!cancelled) {
            setHealth(next);
            setUnavailable(false);
          }
        })
        .catch(() => {
          if (!cancelled) setUnavailable(true);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiUrl]);

  // Until the first reading arrives the bars keep their full layout and show
  // placeholders, so nothing changes height when the numbers land.
  const pending = health === undefined && !unavailable;
  const total = health?.total ?? 0;
  const message = unavailable
    ? health
      ? "Coverage update unavailable. Showing the last measurement."
      : "Coverage is not available right now."
    : health && total === 0
      ? "No titles to measure yet."
      : null;
  return (
    <div className="mb-3" aria-busy={pending}>
      <p className="mt-3 mb-2 text-xs font-medium text-muted">TMDb coverage</p>
      <p className="mb-2 text-xs text-muted empty:hidden" role="status">
        {message}
      </p>
      <div className="flex flex-col gap-3">
        <HealthBar
          label="Posters"
          filled={health?.posters ?? 0}
          total={total}
          pending={pending}
        />
        <HealthBar
          label="Synopses"
          filled={health?.synopses ?? 0}
          total={total}
          pending={pending}
        />
        <HealthBar
          label="Age ratings"
          filled={health?.certifications ?? 0}
          total={total}
          pending={pending}
        />
      </div>
    </div>
  );
}

function HealthBar({
  label,
  filled,
  total,
  pending = false,
}: {
  label: string;
  filled: number;
  total: number;
  pending?: boolean;
}): JSX.Element {
  const percent = tmdbHealthPercent(filled, total);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="tabular">
          {pending
            ? "—"
            : `${percent.label} · ${filled.toLocaleString()} of ${total.toLocaleString()}`}
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
