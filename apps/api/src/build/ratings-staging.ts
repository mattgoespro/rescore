import type { CatalogDatabase } from "../catalog/index.js";
import { imdbValue, readTsvRows } from "../services/gzip-tsv.js";
import { STAGING_BATCH } from "./types.js";
import { log } from "./progress.js";

const IMDB_ID = /^tt\d+$/i;

export async function stageRatings(
  catalog: CatalogDatabase,
  file: string,
): Promise<number> {
  catalog.clearRatingsStaging();
  let batch: Array<{ id: string; rating: number; votes: number }> = [];
  let count = 0;
  for await (const [tconst, averageRating, numVotes] of readTsvRows(file)) {
    const id = imdbValue(tconst)?.toLowerCase();
    if (!id || !IMDB_ID.test(id)) continue;
    const rating = Number(averageRating);
    const votes = Number(numVotes);
    if (!Number.isFinite(rating) || !Number.isFinite(votes)) continue;
    batch.push({ id, rating, votes });
    count += 1;
    if (batch.length >= STAGING_BATCH) {
      catalog.insertRatingsStaging(batch);
      batch = [];
    }
  }
  catalog.insertRatingsStaging(batch);
  log(`Staged ${count.toLocaleString()} ratings`);
  return count;
}
