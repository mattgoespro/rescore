import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  normalizeSettings,
  titleKey,
  type LibraryEntry,
  type MediaType,
  type Settings,
} from "../shared/types";

interface PersistedState {
  settings: Settings;
  library: Record<string, LibraryEntry>;
}

function emptyState(): PersistedState {
  return { settings: normalizeSettings(), library: {} };
}

export class AppStore {
  private path: string;
  private imdbIdsPath: string;
  private state: PersistedState;
  private imdbIds: Record<string, string>;
  private imdbSaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "rescore.json");
    this.imdbIdsPath = join(dir, "imdb-ids.json");
    this.state = this.load();
    this.imdbIds = this.loadImdbIds();
  }

  private load(): PersistedState {
    try {
      if (!existsSync(this.path)) return emptyState();
      const raw = JSON.parse(
        readFileSync(this.path, "utf8"),
      ) as Partial<PersistedState>;
      const library: Record<string, LibraryEntry> = {};
      for (const entry of Object.values(raw.library ?? {})) {
        if (!entry?.imdbId) continue;
        const normalized = normalizeEntry(entry);
        library[titleKey(normalized)] = normalized;
      }
      return {
        settings: normalizeSettings(raw.settings),
        library,
      };
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), "utf8");
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

  listLibrary(): LibraryEntry[] {
    return Object.values(this.state.library).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  getEntry(
    imdbId: string,
    mediaType: MediaType = "movie",
  ): LibraryEntry | undefined {
    return this.state.library[titleKey({ imdbId, mediaType })];
  }

  upsertEntry(entry: LibraryEntry): LibraryEntry {
    const normalized = normalizeEntry(entry);
    this.state.library[titleKey(normalized)] = normalized;
    this.save();
    return normalized;
  }

  removeEntry(imdbId: string, mediaType: MediaType = "movie"): void {
    delete this.state.library[titleKey({ imdbId, mediaType })];
    this.save();
  }

  clearLibrary(): void {
    this.state.library = {};
    this.save();
  }

  listImdbIds(): Record<string, string> {
    return { ...this.imdbIds };
  }

  setImdbId(key: string, imdbId: string): void {
    if (!key || !imdbId || this.imdbIds[key] === imdbId) return;
    this.imdbIds[key] = imdbId;
    this.scheduleImdbIdSave();
  }

  private loadImdbIds(): Record<string, string> {
    try {
      if (!existsSync(this.imdbIdsPath)) return {};
      const raw = JSON.parse(readFileSync(this.imdbIdsPath, "utf8")) as Record<
        string,
        unknown
      >;
      const ids: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw ?? {})) {
        if (typeof value === "string" && /^tt\d+$/i.test(value))
          ids[key] = value.toLowerCase();
      }
      return ids;
    } catch {
      return {};
    }
  }

  private scheduleImdbIdSave(): void {
    if (this.imdbSaveTimer) return;
    this.imdbSaveTimer = setTimeout(() => {
      this.imdbSaveTimer = undefined;
      this.saveImdbIds();
    }, 250);
  }

  private saveImdbIds(): void {
    writeFileSync(this.imdbIdsPath, JSON.stringify(this.imdbIds), "utf8");
  }

  exportLibrary(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        library: this.listLibrary(),
      },
      null,
      2,
    );
  }
}

function normalizeEntry(entry: LibraryEntry): LibraryEntry {
  const mediaType = entry.mediaType ?? "movie";
  return {
    ...entry,
    mediaType,
    titleKind: entry.titleKind ?? (mediaType === "tv" ? "tv" : "movie"),
  };
}
