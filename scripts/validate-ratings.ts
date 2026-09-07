import { createReadStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { chromium, type Browser, type Page } from "playwright";

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE) || 30;
const MIN_VOTES = Number(process.env.MIN_VOTES) || 1_000;
const DELAY_MS = Number(process.env.DELAY_MS) || 800;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6);
const DATASET_FILE =
  process.env.IMDB_RATINGS_FILE ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "apps",
    "api",
    "data",
    "title.ratings.tsv.gz",
  );

const IMDB_ID = /^tt\d+$/i;
const BROWSER_CHANNELS = ["msedge", "chrome"] as const;

interface DatasetRow {
  id: string;
  rating: number;
  votes: number;
}

interface CheckResult {
  id: string;
  url: string;
  dataset: number;
  page: number | null;
  match: boolean | null;
  error?: string;
}

function ratingTenths(value: number): number {
  return Math.round(value * 10);
}

function ratingsMatch(dataset: number, page: number): boolean {
  return ratingTenths(dataset) === ratingTenths(page);
}

async function parseDataset(file: string): Promise<DatasetRow[]> {
  const rows: DatasetRow[] = [];
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let header = true;
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    if (!line) continue;
    const [tconst, averageRating, numVotes] = line.split("\t");
    if (!tconst || !IMDB_ID.test(tconst)) continue;
    const rating = Number(averageRating);
    const votes = Number(numVotes);
    if (
      !Number.isFinite(rating) ||
      !Number.isFinite(votes) ||
      votes < MIN_VOTES
    )
      continue;
    rows.push({ id: tconst.toLowerCase(), rating, votes });
  }

  return rows;
}

function sampleRows(rows: DatasetRow[], size: number): DatasetRow[] {
  const take = Math.min(size, rows.length);
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = pool[i];
    const swap = pool[j];
    if (current == null || swap == null) continue;
    pool[i] = swap;
    pool[j] = current;
  }
  return pool
    .slice(0, take)
    .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
}

async function launchBrowser(): Promise<Browser> {
  const options = {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  for (const channel of BROWSER_CHANNELS) {
    try {
      return await chromium.launch({ ...options, channel });
    } catch {
      /* try the next installed browser */
    }
  }
  return chromium.launch(options);
}

async function readJsonLdRating(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      try {
        const parsed = JSON.parse(script.textContent ?? "") as {
          aggregateRating?: { ratingValue?: string | number };
          "@graph"?: Array<{
            aggregateRating?: { ratingValue?: string | number };
          }>;
        };
        const value =
          parsed.aggregateRating?.ratingValue ??
          parsed["@graph"]?.[0]?.aggregateRating?.ratingValue;
        const rating = Number(value);
        if (Number.isFinite(rating)) return rating;
      } catch {
        /* try the next JSON-LD block */
      }
    }
    return null;
  });
}

async function readPageRating(page: Page, id: string): Promise<number> {
  await page.goto(`https://www.imdb.com/title/${id}/`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForFunction(() => document.title.includes("IMDb"), {
    timeout: 30_000,
  });

  const hero = page
    .locator('[data-testid="hero-rating-bar__aggregate-rating__score"] span')
    .first();
  try {
    const text = (await hero.textContent({ timeout: 4_000 }))?.trim() ?? "";
    const rating = Number(text.replace(/[^\d.]/g, ""));
    if (Number.isFinite(rating)) return rating;
  } catch {
    /* JSON-LD is the same score the title page publishes */
  }

  const fromJsonLd = await readJsonLdRating(page);
  if (fromJsonLd == null) throw new Error("No rating found on page");
  return fromJsonLd;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkRow(page: Page, row: DatasetRow): Promise<CheckResult> {
  const url = `https://www.imdb.com/title/${row.id}/`;
  let pageRating: number | null = null;
  let error: string | undefined;
  try {
    pageRating = await readPageRating(page, row.id);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Page read failed";
  }
  return {
    id: row.id,
    url,
    dataset: row.rating,
    page: pageRating,
    match: pageRating == null ? null : ratingsMatch(row.rating, pageRating),
    error,
  };
}

function formatRow(result: CheckResult): string {
  const page = result.page == null ? "—" : result.page.toFixed(1);
  const verdict =
    result.match == null
      ? `skip (${result.error})`
      : result.match
        ? "match"
        : "MISMATCH";
  return `${result.id.padEnd(12)}  dataset ${result.dataset.toFixed(1)}  page ${page.padStart(4)}  ${verdict}`;
}

async function main(): Promise<void> {
  if (!existsSync(DATASET_FILE)) {
    throw new Error(
      `Dataset not found at ${DATASET_FILE}. Start the API once so it can download title.ratings.tsv.gz.`,
    );
  }

  const rows = await parseDataset(DATASET_FILE);
  if (rows.length < SAMPLE_SIZE) {
    throw new Error(
      `Only ${rows.length} titles have at least ${MIN_VOTES} votes; need ${SAMPLE_SIZE} for a sample.`,
    );
  }

  const sample = sampleRows(rows, SAMPLE_SIZE);
  const workers = Math.min(CONCURRENCY, sample.length);
  console.log(
    `Sampled ${sample.length} titles (>= ${MIN_VOTES} votes) from ${rows.length} eligible rows.`,
  );
  console.log(
    `Opening official title pages with ${workers} concurrent browsers…\n`,
  );

  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const pages = await Promise.all(
    Array.from({ length: workers }, () => context.newPage()),
  );
  const results: CheckResult[] = [];
  try {
    const queue = [...sample];
    await Promise.all(
      pages.map(async (page) => {
        while (queue.length) {
          const row = queue.shift();
          if (row == null) return;
          const result = await checkRow(page, row);
          results.push(result);
          console.log(formatRow(result));
          if (DELAY_MS && queue.length) await sleep(DELAY_MS);
        }
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const compared = results.filter((result) => result.match != null);
  const matches = compared.filter((result) => result.match).length;
  const mismatches = compared.filter((result) => result.match === false);
  const skipped = results.length - compared.length;
  const accuracy = compared.length ? matches / compared.length : 0;

  console.log("");
  console.log(`Compared   ${compared.length}`);
  console.log(`Matches    ${matches}`);
  console.log(`Mismatches ${mismatches.length}`);
  console.log(`Skipped    ${skipped}`);
  console.log(`Accuracy   ${(accuracy * 100).toFixed(1)}%`);

  if (mismatches.length) {
    console.log("\nMismatches:");
    for (const result of mismatches)
      console.log(`  ${formatRow(result)}  ${result.url}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
