import { BrowserWindow, type Session, session } from "electron";
import {
  CHECKINS_LIST_SELECTOR,
  scrapeWatchedList,
  type ImdbPageDriver,
} from "./imdb-watched";

const PARTITION = "persist:imdb-watched";

export function clearImdbWatchedSession(): void {
  void session.fromPartition(PARTITION).clearStorageData();
}

export async function scrapeImdbCheckins(
  credentials: { email: string; password: string },
  parent: BrowserWindow | null,
): Promise<string[]> {
  const { driver, window } = openImdbWatchedDriver(parent);
  try {
    return await scrapeWatchedList(driver, credentials);
  } finally {
    if (!window.isDestroyed()) window.close();
  }
}

export function openImdbWatchedDriver(parent: BrowserWindow | null): {
  driver: ImdbPageDriver;
  window: BrowserWindow;
} {
  const ses: Session = session.fromPartition(PARTITION);
  const window = new BrowserWindow({
    width: 980,
    height: 760,
    show: false,
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  let closed = false;
  window.on("closed", () => {
    closed = true;
  });
  const driver: ImdbPageDriver = {
    load: (url) => window.loadURL(url).then(() => undefined),
    html: () =>
      window.webContents.executeJavaScript(
        "document.documentElement.outerHTML",
        true,
      ),
    titleHrefs: () =>
      window.webContents.executeJavaScript(
        `(() => {
          const root = document.querySelector(${JSON.stringify(CHECKINS_LIST_SELECTOR)}) || document.querySelector("main");
          if (!root) return [];
          return [...root.querySelectorAll('a[href*="/title/tt"]')].map((a) => a.getAttribute("href") || a.href);
        })()`,
        true,
      ),
    fillLogin: async (email, password) => {
      await window.webContents.executeJavaScript(
        fillLoginScript(email, password),
        true,
      );
    },
    submitLogin: async () => {
      await window.webContents.executeJavaScript(
        `(() => {
          const submit = document.querySelector('#signInSubmit, #continue, input[type="submit"], button[type="submit"]');
          if (submit instanceof HTMLElement) submit.click();
        })()`,
        true,
      );
      await waitForPossibleNavigation(window);
    },
    clickSignInWithImdb: async () => {
      const clicked = await window.webContents.executeJavaScript(
        `(() => {
          const link = [...document.querySelectorAll("a, button")].find((el) =>
            /sign in with imdb/i.test(el.textContent || "") ||
            /\\/ap\\/signin/i.test(el.getAttribute("href") || ""),
          );
          if (link instanceof HTMLElement) {
            link.click();
            return true;
          }
          return false;
        })()`,
        true,
      );
      if (clicked) await waitForPossibleNavigation(window);
      return Boolean(clicked);
    },
    clickMore: async () => {
      const clicked = await window.webContents.executeJavaScript(
        `(() => {
          const btn = document.querySelector(
            'button[data-testid*="pagination-next"], button.ipc-see-more__button, .ipc-see-more button, [data-testid*="hero-list-subnav-see-more"] button',
          );
          if (!(btn instanceof HTMLElement) || (btn instanceof HTMLButtonElement && btn.disabled)) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      if (clicked) await delay(800);
      return Boolean(clicked);
    },
    scrollToEnd: async () => {
      await window.webContents.executeJavaScript(
        "window.scrollTo(0, document.documentElement.scrollHeight)",
        true,
      );
      await delay(400);
    },
    show: async () => {
      if (!window.isDestroyed()) window.show();
    },
    closed: () => closed || window.isDestroyed(),
  };
  return { driver, window };
}

function fillLoginScript(email: string, password: string): string {
  return `(() => {
    const emailEl = document.querySelector('#ap_email, input[type="email"], input[name="email"]');
    const passwordEl = document.querySelector('#ap_password, input[type="password"], input[name="password"]');
    const nativeSet = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    const setValue = (el, value) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.focus();
      if (nativeSet) nativeSet.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue(emailEl, ${JSON.stringify(email)});
    setValue(passwordEl, ${JSON.stringify(password)});
  })()`;
}

function waitForPossibleNavigation(
  window: BrowserWindow,
  ms = 4000,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.webContents.removeListener("did-finish-load", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    window.webContents.once("did-finish-load", finish);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
