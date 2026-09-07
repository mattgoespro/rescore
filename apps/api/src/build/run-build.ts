import { CATALOG_DB_PATH } from "../config.js";
import type { CatalogDatabase } from "../catalog/index.js";
import { downloadCreditDumps, downloadTitleDumps } from "./download-dumps.js";
import { importBasics } from "./import-basics.js";
import {
  importCrew,
  importNames,
  importPrincipals,
  insertCredits,
} from "./import-credits.js";
import { log, setProgressSink } from "./progress.js";
import { stageRatings } from "./ratings-staging.js";
import type {
  CatalogBuildOptions,
  CatalogBuildResult,
  Credit,
} from "./types.js";

let creditsInflight: Promise<void> | null = null;

export async function buildCatalog(
  catalog: CatalogDatabase,
  options: CatalogBuildOptions = {},
): Promise<CatalogBuildResult> {
  const titles = await buildCatalogTitles(catalog, options);
  await buildCatalogCredits(catalog, options);
  return titles;
}

export async function buildCatalogTitles(
  catalog: CatalogDatabase,
  options: CatalogBuildOptions = {},
): Promise<CatalogBuildResult> {
  setProgressSink(options.onProgress);
  try {
    return await runBuildTitles(catalog);
  } finally {
    setProgressSink(undefined);
  }
}

export async function buildCatalogCredits(
  catalog: CatalogDatabase,
  options: CatalogBuildOptions = {},
): Promise<void> {
  if (catalog.creditsReady() && !catalog.isCreditsInProgress()) return;
  if (creditsInflight) return creditsInflight;
  setProgressSink(options.onProgress);
  creditsInflight = runBuildCredits(catalog)
    .catch((error: unknown) => {
      console.warn(
        "Credits import failed.",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      creditsInflight = null;
      setProgressSink(undefined);
    });
  return creditsInflight;
}

export function startCreditsBuild(
  catalog: CatalogDatabase,
  options: CatalogBuildOptions = {},
): Promise<void> {
  return buildCatalogCredits(catalog, options);
}

async function runBuildTitles(
  catalog: CatalogDatabase,
): Promise<CatalogBuildResult> {
  const files = await downloadTitleDumps();
  log("Staging IMDb ratings");
  await stageRatings(catalog, files.ratings);

  const library = catalog.snapshotLibrary();
  const posters = catalog.snapshotPosterUrls();

  catalog.setBuildInProgress(true);
  catalog.setCreditsReady(false);
  catalog.startRebuild();
  try {
    log("Importing title.basics");
    const imported = await importBasics(catalog, files.basics);
    log(`Imported ${imported.toLocaleString()} titles`);
    const kept = catalog.titleIdSet();
    catalog.updatePosterUrls(
      posters
        .filter((row) => kept.has(row.id))
        .map((row) => ({
          id: row.id,
          posterUrl: row.posterUrl,
          synopsis: row.synopsis,
        })),
    );
  } catch (error) {
    catalog.finishRebuild(library);
    throw error;
  }

  catalog.finishRebuild(library);
  const builtAt = new Date().toISOString();
  const revision = builtAt;
  catalog.setCatalogMeta({
    builtAt,
    revision,
    source: "imdb-noncommercial-datasets",
  });
  catalog.setBuildInProgress(false);
  const titleCount = catalog.titleCount();
  log(`Titles ready: ${titleCount.toLocaleString()} titles`);
  void catalog.queueAnalyze();
  return { titleCount, builtAt, revision };
}

async function runBuildCredits(catalog: CatalogDatabase): Promise<void> {
  if (catalog.creditsReady() && !catalog.isCreditsInProgress()) return;
  const files = await downloadCreditDumps();
  const kept = catalog.titleIdSet();
  const directors = new Map<string, Credit[]>();
  const cast = new Map<string, Credit[]>();
  const neededNames = new Set<string>();

  catalog.setCreditsInProgress(true);
  catalog.startCreditsRebuild();
  try {
    log("Reading title.crew");
    await importCrew(files.crew, kept, directors, neededNames);
    log("Reading title.principals");
    await importPrincipals(files.principals, kept, cast, neededNames);
    log(`Resolving ${neededNames.size.toLocaleString()} names`);
    const names = await importNames(files.names, neededNames);
    log("Writing credits");
    insertCredits(catalog, directors, cast, names);
  } catch (error) {
    catalog.finishCreditsRebuild();
    catalog.setCreditsInProgress(false);
    throw error;
  }

  catalog.finishCreditsRebuild();
  catalog.setCreditsReady(true);
  catalog.setCreditsInProgress(false);
  log("Credits ready");
  void catalog.queueAnalyze("title_people");
}

export function defaultCatalogPath(): string {
  return CATALOG_DB_PATH;
}
