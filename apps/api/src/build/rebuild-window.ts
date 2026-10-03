import type { CatalogDatabase } from "../catalog/index.js";

export async function withTitleIngest<T>(
  catalog: CatalogDatabase,
  work: () => Promise<T>,
): Promise<T> {
  catalog.startTitleIngest();
  try {
    const result = await work();
    catalog.finishTitleIngest();
    return result;
  } catch (error) {
    catalog.abortTitleIngest();
    throw error;
  }
}

export async function withCreditsWrite(
  catalog: CatalogDatabase,
  work: () => Promise<void>,
): Promise<void> {
  catalog.setCreditsInProgress(true);
  catalog.startCreditsRebuild();
  try {
    await work();
    catalog.finishCreditsRebuild();
    catalog.setCreditsReady(true);
    catalog.setCreditsFailed(false);
    catalog.setCreditsInProgress(false);
  } catch (error) {
    catalog.finishCreditsRebuild();
    catalog.setCreditsInProgress(false);
    throw error;
  }
}
