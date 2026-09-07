import type { CatalogDatabase, CatalogTitleRow } from "../catalog/index.js";
import { imdbValue, readTsvRows } from "../services/gzip-tsv.js";
import { mapKind, parseGenres, parseRuntime, parseYear } from "./parse-helpers.js";
import { log } from "./progress.js";
import { TITLE_BATCH } from "./types.js";

export async function importBasics(
  catalog: CatalogDatabase,
  file: string,
): Promise<number> {
  let batch: CatalogTitleRow[] = [];
  let scanned = 0;
  let imported = 0;
  for await (const row of readTsvRows(file)) {
    scanned += 1;
    if (scanned % 1_000_000 === 0) {
      log(`  scanned ${scanned.toLocaleString()} basics`);
    }
    const id = imdbValue(row[0])?.toLowerCase();
    if (!id) continue;
    const kind = mapKind(row[1]);
    if (!kind) continue;
    if (row[4] === "1") continue;
    const score = catalog.lookupStagingRating(id);
    if (!score) continue;
    const title = imdbValue(row[2]);
    if (!title) continue;
    batch.push({
      id,
      title,
      originalTitle: imdbValue(row[3]),
      kind,
      year: parseYear(row[5]),
      runtimeMinutes: parseRuntime(row[7]),
      imdbRating: score.rating,
      imdbVotes: score.votes,
      genres: parseGenres(row[8]),
    });
    imported += 1;
    if (batch.length >= TITLE_BATCH) {
      catalog.insertTitleRows(batch);
      batch = [];
    }
  }
  catalog.insertTitleRows(batch);
  catalog.clearRatingsStaging();
  return imported;
}
