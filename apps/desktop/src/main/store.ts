import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  normalizeSearchHistory,
  upsertSearchHistory,
  type SearchHistoryInput,
} from "../shared/search-history";
import {
  normalizeSettings,
  type SearchHistoryEntry,
  type Settings,
} from "../shared/types";

interface PersistedState {
  settings: Settings;
  /**
   * Library rows from before they moved to the catalogue database. Nothing
   * reads them; they are written back unchanged so no user data is dropped.
   */
  library: unknown;
  searchHistory: SearchHistoryEntry[];
}

function emptyState(): PersistedState {
  return { settings: normalizeSettings(), library: {}, searchHistory: [] };
}

export class AppStore {
  private path: string;
  private state: PersistedState;
  private legacySettings = false;

  constructor() {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "rescore.json");
    this.state = this.load();
    if (this.legacySettings) this.save();
  }

  private load(): PersistedState {
    try {
      if (!existsSync(this.path)) return emptyState();
      const raw = JSON.parse(
        readFileSync(this.path, "utf8"),
      ) as Partial<PersistedState>;
      this.legacySettings = hasLegacySettings(raw.settings);
      return {
        settings: normalizeSettings(raw.settings),
        library: raw.library ?? {},
        searchHistory: normalizeSearchHistory(raw.searchHistory),
      };
    } catch {
      return emptyState();
    }
  }

  /**
   * Writes a temporary file and renames it over the old one, so a crash
   * mid-write leaves the previous settings rather than a truncated file.
   */
  private save(): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(temporary, this.path);
  }

  getSettings(): Settings {
    return { ...this.state.settings };
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.state.settings = normalizeSettings({
      ...this.state.settings,
      ...patch,
    });
    this.save();
    return this.getSettings();
  }

  listSearchHistory(): SearchHistoryEntry[] {
    return [...this.state.searchHistory];
  }

  saveSearchHistory(input: SearchHistoryInput): SearchHistoryEntry[] {
    this.state.searchHistory = upsertSearchHistory(
      this.state.searchHistory,
      input,
    );
    this.save();
    return this.listSearchHistory();
  }

  removeSearchHistory(id: string): SearchHistoryEntry[] {
    this.state.searchHistory = this.state.searchHistory.filter(
      (entry) => entry.id !== id,
    );
    this.save();
    return this.listSearchHistory();
  }
}

function hasLegacySettings(settings: unknown): boolean {
  return (
    !!settings &&
    typeof settings === "object" &&
    (Object.hasOwn(settings, "tmdbApiKey") ||
      Object.hasOwn(settings, "tmdbApiKeys") ||
      Object.hasOwn(settings, "region") ||
      Object.hasOwn(settings, "imdbApiUrl"))
  );
}
