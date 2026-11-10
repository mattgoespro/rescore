export const CHECKINS_URL = "https://www.imdb.com/list/checkins";
export const TITLE_ID_CAP = 12_000;
const IDLE_ROUNDS = 2;
const SIGN_IN_ATTEMPTS = 8;

export type LoginStep =
  | "signin-landing"
  | "email"
  | "password"
  | "challenge"
  | "signed-in"
  | "unknown";

export interface ImdbPageDriver {
  load(url: string): Promise<void>;
  html(): Promise<string>;
  titleHrefs(): Promise<string[]>;
  fillLogin(email: string, password: string): Promise<void>;
  submitLogin(): Promise<void>;
  clickSignInWithImdb(): Promise<boolean>;
  clickMore(): Promise<boolean>;
  scrollToEnd(): Promise<void>;
  show(): Promise<void>;
  closed(): boolean;
}

export function titleIdsFromHtml(html: string): string[] {
  return uniqueTitleIds(html.match(/\/title\/tt\d+/gi) ?? []);
}

export function titleIdsFromCheckinsHtml(html: string): string[] {
  const regions = [
    ...(html.match(
      /<ul[^>]*class="[^"]*ipc-metadata-list[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,
    ) ?? []),
    ...(html.match(
      /<[^>]+data-testid="[^"]*list[^"]*"[^>]*>[\s\S]*?<\/(?:section|div|ul|main)>/gi,
    ) ?? []),
  ];
  if (!regions.length) return [];
  return uniqueTitleIds(
    regions.flatMap((region) => region.match(/\/title\/tt\d+/gi) ?? []),
  );
}

export const CHECKINS_LIST_SELECTOR =
  '[data-testid="list-page"], [data-testid*="hero-list"], .ipc-metadata-list, ul[class*="ipc-metadata-list"]';

export function uniqueTitleIds(hrefs: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const match = /\/title\/(tt\d+)/i.exec(href);
    if (!match) continue;
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= TITLE_ID_CAP) break;
  }
  return ids;
}

export function loginStep(html: string): LoginStep {
  const onCheckins = /Your Check-ins/i.test(html) || /hero-list/i.test(html);
  const challengeWidget =
    /id=["']auth-mfa-otpcode["']|id=["']ap_captcha["']|name=["']otpCode["']/i.test(
      html,
    );
  if (challengeWidget && !onCheckins) return "challenge";
  if (/id=["']ap_password["']/i.test(html)) return "password";
  if (/id=["']ap_email["']/i.test(html)) return "email";
  if (onCheckins) return "signed-in";
  if (/Sign in with IMDb/i.test(html) || /\/ap\/signin/i.test(html))
    return "signin-landing";
  return "unknown";
}

export async function scrapeWatchedList(
  driver: ImdbPageDriver,
  credentials: { email: string; password: string },
): Promise<string[]> {
  await driver.load(CHECKINS_URL);
  await ensureSignedIn(driver, credentials);
  await driver.load(CHECKINS_URL);
  const ids = await collectIds(driver);
  // A signed-in page whose list selectors no longer match reads as empty too,
  // so say so rather than report an import of nothing.
  if (!ids.length)
    throw new Error(
      "Found no titles in Your Check-ins on IMDb. Check imdb.com/list/checkins.",
    );
  return ids;
}

async function ensureSignedIn(
  driver: ImdbPageDriver,
  credentials: { email: string; password: string },
): Promise<void> {
  let submitted: LoginStep | null = null;
  for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS; attempt++) {
    if (driver.closed()) throw new Error("IMDb sign-in window closed.");
    const step = loginStep(await driver.html());
    if (step === "signed-in") return;
    if (step === "signin-landing") {
      await driver.clickSignInWithImdb();
      continue;
    }
    if (step === "email" || step === "password") {
      if (submitted === step) {
        await driver.show();
        continue;
      }
      await driver.fillLogin(credentials.email, credentials.password);
      await driver.submitLogin();
      submitted = step;
      continue;
    }
    if (step === "challenge") {
      await driver.show();
      continue;
    }
  }
  if (loginStep(await driver.html()) === "signed-in") return;
  await driver.show();
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    if (driver.closed()) throw new Error("IMDb sign-in window closed.");
    if (loginStep(await driver.html()) === "signed-in") return;
    await delay(500);
  }
  throw new Error("Could not sign in to IMDb.");
}

async function collectIds(driver: ImdbPageDriver): Promise<string[]> {
  const ids = new Set<string>();
  let idle = 0;
  while (ids.size < TITLE_ID_CAP && idle < IDLE_ROUNDS) {
    if (driver.closed()) throw new Error("IMDb window closed.");
    const before = ids.size;
    for (const id of uniqueTitleIds(await driver.titleHrefs())) {
      ids.add(id);
      if (ids.size >= TITLE_ID_CAP) return [...ids];
    }
    if (ids.size === before) idle += 1;
    else idle = 0;
    if (idle >= IDLE_ROUNDS) break;
    await driver.clickMore();
    await driver.scrollToEnd();
  }
  return [...ids];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
