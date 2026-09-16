import type { CatalogDatabase, CatalogPersonRow } from "../catalog/index.js";
import { imdbValue, readTsvRows } from "../services/gzip-tsv.js";
import { trimCredits } from "./parse-helpers.js";
import { log } from "./progress.js";
import {
  MAX_CAST,
  MAX_DIRECTORS,
  type Credit,
} from "./types.js";

export async function importCrew(
  file: string,
  kept: Set<string>,
  directors: Map<string, Credit[]>,
  neededNames: Set<string>,
): Promise<void> {
  let scanned = 0;
  for await (const row of readTsvRows(file)) {
    scanned += 1;
    if (scanned % 1_000_000 === 0) {
      log(`  scanned ${scanned.toLocaleString()} crew`);
    }
    const id = imdbValue(row[0])?.toLowerCase();
    if (!id || !kept.has(id)) continue;
    const nconsts = (imdbValue(row[1]) ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^nm\d+$/i.test(value))
      .slice(0, MAX_DIRECTORS);
    if (!nconsts.length) continue;
    directors.set(
      id,
      nconsts.map((nconst, ordering) => ({ nconst, ordering })),
    );
    for (const nconst of nconsts) neededNames.add(nconst);
  }
}

export async function importPrincipals(
  file: string,
  kept: Set<string>,
  cast: Map<string, Credit[]>,
  neededNames: Set<string>,
): Promise<void> {
  let scanned = 0;
  for await (const row of readTsvRows(file)) {
    scanned += 1;
    if (scanned % 5_000_000 === 0) {
      log(`  scanned ${scanned.toLocaleString()} principals`);
    }
    const id = imdbValue(row[0])?.toLowerCase();
    if (!id || !kept.has(id)) continue;
    const category = (row[3] ?? "").toLowerCase();
    if (category !== "actor" && category !== "actress") continue;
    const nconst = imdbValue(row[2])?.toLowerCase();
    if (!nconst || !/^nm\d+$/i.test(nconst)) continue;
    const ordering = Number(row[1]);
    const list = cast.get(id) ?? [];
    list.push({
      nconst,
      ordering: Number.isFinite(ordering) ? ordering : list.length,
    });
    if (list.length > MAX_CAST * 2) trimCredits(list, MAX_CAST);
    cast.set(id, list);
  }
  for (const [id, list] of cast) {
    trimCredits(list, MAX_CAST);
    if (!list.length) {
      cast.delete(id);
      continue;
    }
    for (const credit of list) neededNames.add(credit.nconst);
  }
}

export async function importNames(
  file: string,
  neededNames: Set<string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!neededNames.size) return names;
  let scanned = 0;
  for await (const row of readTsvRows(file)) {
    scanned += 1;
    if (scanned % 1_000_000 === 0) {
      log(`  scanned ${scanned.toLocaleString()} names`);
    }
    const nconst = imdbValue(row[0])?.toLowerCase();
    if (!nconst || !neededNames.has(nconst)) continue;
    const name = imdbValue(row[1]);
    if (name) names.set(nconst, name);
    if (names.size === neededNames.size) break;
  }
  return names;
}

function creditSignature(rows: CatalogPersonRow[]): string {
  return rows.map((row) => `${row.role}:${row.nconst}`).join("|");
}

export function insertCredits(
  catalog: CatalogDatabase,
  directors: Map<string, Credit[]>,
  cast: Map<string, Credit[]>,
  names: Map<string, string>,
  kept: Set<string>,
): void {
  const existing = catalog.creditSignatures();
  const byTitle = new Map<string, CatalogPersonRow[]>();
  const push = (
    titleId: string,
    credits: Credit[],
    role: "director" | "cast",
  ): void => {
    credits.forEach((credit, position) => {
      const name = names.get(credit.nconst);
      if (!name) return;
      const list = byTitle.get(titleId) ?? [];
      list.push({
        titleId,
        nconst: credit.nconst,
        name,
        role,
        position,
      });
      byTitle.set(titleId, list);
    });
  };
  for (const [titleId, credits] of directors) {
    push(titleId, credits, "director");
  }
  for (const [titleId, credits] of cast) {
    trimCredits(credits, MAX_CAST);
    push(titleId, credits, "cast");
  }
  for (const titleId of kept) {
    const rows = byTitle.get(titleId) ?? [];
    if (creditSignature(rows) === (existing.get(titleId) ?? "")) continue;
    catalog.replaceTitleCredits(titleId, rows);
  }
}
