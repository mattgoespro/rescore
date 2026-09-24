import { CATALOG_DB_PATH } from "../config.js";
import type { CatalogDatabase } from "../catalog/index.js";
import { dumpFingerprint, probeRemote } from "../services/gzip-tsv.js";
import { parseRatingsTsv } from "../services/dataset.js";
import {
  downloadCreditDumps,
  downloadTitleDumps,
  titleDumpUrls,
} from "./download-dumps.js";
import { shouldDeferTitleIngest } from "./defer-ingest.js";
import { ingestTitles } from "./import-basics.js";
import {
  importCrew,
  importNames,
  importPrincipals,
  insertCredits,
} from "./import-credits.js";
import { log, setProgressSink } from "./progress.js";
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
    return await runBuildTitles(catalog, options.force === true);
  } finally {
    setProgressSink(undefined);
  }
}

export async function buildCatalogCredits(
  catalog: CatalogDatabase,
  options: CatalogBuildOptions = {},
): Promise<void> {
  if (creditsInflight) return creditsInflight;
  setProgressSink(options.onProgress);
  creditsInflight = runBuildCredits(catalog, options.force === true)
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

function titleDumpKey(files: { ratings: string; basics: string }): string {
  return [dumpFingerprint(files.ratings), dumpFingerprint(files.basics)].join(
    "\n",
  );
}

type RemoteProbe = Awaited<ReturnType<typeof probeRemote>>;

interface TitleRemoteProbes {
  ratings: RemoteProbe;
  basics: RemoteProbe;
}

/**
 * A component only counts once the probe actually resolved something; a
 * failed HEAD request must never be treated as an empty-but-known value, or
 * it would look identical to a dump that genuinely has no etag/last-modified.
 */
function remoteProbeFingerprint(probe: RemoteProbe): string | null {
  return (
    probe.etag ??
    probe.lastModified ??
    (probe.contentLength != null ? String(probe.contentLength) : null)
  );
}

/**
 * The overall fingerprint is only meaningful when BOTH dumps resolved a
 * component. A partial probe failure must not be comparable at all — it must
 * never present as a confirmed match or a confirmed mismatch.
 */
function remoteTitleDumpFingerprint(probes: TitleRemoteProbes): string | null {
  const ratingsPart = remoteProbeFingerprint(probes.ratings);
  const basicsPart = remoteProbeFingerprint(probes.basics);
  if (ratingsPart == null || basicsPart == null) return null;
  return [ratingsPart, basicsPart].join("\n");
}

async function probeTitleDumps(): Promise<TitleRemoteProbes> {
  const urls = titleDumpUrls();
  const [ratings, basics] = await Promise.all([
    probeRemote(urls.ratings),
    probeRemote(urls.basics),
  ]);
  return { ratings, basics };
}

async function runBuildTitles(
  catalog: CatalogDatabase,
  force: boolean,
): Promise<CatalogBuildResult> {
  const existing = catalog.catalogMeta();

  if (force) {
    return reconcileTitles(catalog, existing, await downloadTitleDumps(force), force);
  }

  // Probe once and thread the exact same result into both the defer
  // decision and the downloader's reuse decision, so a dump cannot change
  // between an initial check and a second, independent probe.
  const probes = await probeTitleDumps();
  const deferred = shouldDeferTitleIngest({
    force,
    titleCount: catalog.titleCount(),
    builtAt: existing.builtAt,
    storedFingerprint: catalog.titleDumpFingerprint(),
    remoteFingerprint: remoteTitleDumpFingerprint(probes),
  });
  if (deferred && existing.builtAt) {
    log("Title dumps changed remotely; keeping existing catalogue searchable");
    catalog.setTitlesUpdateAvailable(true);
    return {
      titleCount: catalog.titleCount(),
      builtAt: existing.builtAt,
      revision: existing.revision ?? existing.builtAt,
      unchanged: true,
    };
  }

  return reconcileTitles(
    catalog,
    existing,
    await downloadTitleDumps(force, probes),
    force,
  );
}

async function reconcileTitles(
  catalog: CatalogDatabase,
  existing: { builtAt: string | null; revision: string | null },
  files: { ratings: string; basics: string },
  force: boolean,
): Promise<CatalogBuildResult> {
  const fingerprint = titleDumpKey(files);
  if (
    !force &&
    catalog.titleCount() > 0 &&
    existing.builtAt &&
    catalog.titleDumpFingerprint() === fingerprint
  ) {
    log("Title dumps unchanged; keeping existing catalogue");
    catalog.setTitlesUpdateAvailable(false);
    return {
      titleCount: catalog.titleCount(),
      builtAt: existing.builtAt,
      revision: existing.revision ?? existing.builtAt,
      unchanged: true,
    };
  }

  log("Loading IMDb ratings");
  const ratings = await parseRatingsTsv(files.ratings);
  const firstBuild = catalog.titleCount() === 0;
  catalog.setBuildInProgress(true);
  if (firstBuild) catalog.setCreditsReady(false);
  try {
    log("Reconciling title.basics");
    const imported = await ingestTitles(catalog, files.basics, ratings);
    log(`Reconciled ${imported.toLocaleString()} titles`);
  } catch (error) {
    catalog.setBuildInProgress(false);
    throw error;
  }

  const builtAt = new Date().toISOString();
  const revision = builtAt;
  catalog.setCatalogMeta({
    builtAt,
    revision,
    source: "imdb-noncommercial-datasets",
  });
  catalog.setTitleDumpFingerprint(fingerprint);
  catalog.setBuildInProgress(false);
  catalog.setTitlesUpdateAvailable(false);
  const titleCount = catalog.titleCount();
  log(`Titles ready: ${titleCount.toLocaleString()} titles`);
  void catalog.queueAnalyze();
  return { titleCount, builtAt, revision };
}

function creditDumpKey(files: {
  crew: string;
  principals: string;
  names: string;
}): string {
  return [
    dumpFingerprint(files.crew),
    dumpFingerprint(files.principals),
    dumpFingerprint(files.names),
  ].join("\n");
}

async function runBuildCredits(
  catalog: CatalogDatabase,
  force: boolean,
): Promise<void> {
  const files = await downloadCreditDumps(force);
  const fingerprint = creditDumpKey(files);
  if (
    !force &&
    catalog.creditsReady() &&
    !catalog.isCreditsInProgress() &&
    catalog.creditsDumpFingerprint() === fingerprint
  ) {
    log("Credit dumps unchanged; keeping existing credits");
    return;
  }

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
    const known = catalog.peopleNames(neededNames);
    for (const nconst of known.keys()) neededNames.delete(nconst);
    log(`Resolving ${neededNames.size.toLocaleString()} names`);
    const names = await importNames(files.names, neededNames);
    for (const [nconst, name] of known) names.set(nconst, name);
    log("Writing credits");
    insertCredits(catalog, directors, cast, names, kept);
  } catch (error) {
    catalog.finishCreditsRebuild();
    catalog.setCreditsInProgress(false);
    throw error;
  }

  catalog.finishCreditsRebuild();
  catalog.setCreditsReady(true);
  catalog.setCreditsDumpFingerprint(fingerprint);
  catalog.setCreditsInProgress(false);
  log("Credits ready");
  void catalog.queueAnalyze("title_people");
}

export function defaultCatalogPath(): string {
  return CATALOG_DB_PATH;
}
