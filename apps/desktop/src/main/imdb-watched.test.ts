import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHECKINS_URL,
  loginStep,
  scrapeWatchedList,
  titleIdsFromCheckinsHtml,
  titleIdsFromHtml,
  type ImdbPageDriver,
} from "./imdb-watched";

test("title ids come from title links, ignore people, and dedupe", () => {
  assert.deepEqual(
    titleIdsFromHtml(`
      <a href="/title/tt0133093/">The Matrix</a>
      <a href="https://www.imdb.com/title/tt0133093/?ref_=ls">again</a>
      <a href="/name/nm0000206/">Keanu</a>
      <a href="/title/tt0234215">Reloaded</a>
    `),
    ["tt0133093", "tt0234215"],
  );
});

test("check-ins ids ignore sidebar recommendations", () => {
  assert.deepEqual(
    titleIdsFromCheckinsHtml(`
      <a href="/title/tt9999999/">Recommended</a>
      <ul class="ipc-metadata-list">
        <a href="/title/tt0133093/">The Matrix</a>
      </ul>
      <a href="/title/tt8888888/">Footer</a>
    `),
    ["tt0133093"],
  );
});

test("loginStep distinguishes landing, amazon form, challenge, and a list page", () => {
  assert.equal(
    loginStep('<a href="/ap/signin">Sign in with IMDb</a>'),
    "signin-landing",
  );
  assert.equal(
    loginStep('<input id="ap_email" /><input id="ap_password" />'),
    "password",
  );
  assert.equal(loginStep('<input id="ap_email" />'), "email");
  assert.equal(
    loginStep('<input id="auth-mfa-otpcode" name="otpCode" />'),
    "challenge",
  );
  assert.equal(
    loginStep('<a href="/title/tt0133093/">The Matrix</a>'),
    "unknown",
  );
  assert.equal(
    loginStep("<h1>Your Check-ins</h1><p>This list is empty.</p>"),
    "signed-in",
  );
});

test("scrapeWatchedList signs in then collects ids until the list stops growing", async () => {
  const filled: string[] = [];
  let page = "landing";
  const hrefs: string[][] = [
    ["/title/tt1/", "/name/nm1/"],
    ["/title/tt1/", "/title/tt2/"],
    ["/title/tt1/", "/title/tt2/"],
  ];
  const driver: ImdbPageDriver = {
    load: async (url) => {
      assert.equal(url, CHECKINS_URL);
      if (page === "ready") page = "list";
    },
    html: async () => {
      if (page === "landing")
        return '<a href="/ap/signin">Sign in with IMDb</a>';
      if (page === "form")
        return '<input id="ap_email" /><input id="ap_password" />';
      return "<h1>Your Check-ins</h1><a href='/title/tt1/'>One</a>";
    },
    titleHrefs: async () => hrefs.shift() ?? hrefs[hrefs.length - 1] ?? [],
    fillLogin: async (email, password) => {
      filled.push(email, password);
    },
    submitLogin: async () => {
      page = "ready";
    },
    clickSignInWithImdb: async () => {
      page = "form";
      return true;
    },
    clickMore: async () => true,
    scrollToEnd: async () => {},
    show: async () => {
      throw new Error("should not show");
    },
    closed: () => false,
  };
  assert.deepEqual(
    await scrapeWatchedList(driver, {
      email: "user@imdb.example",
      password: "secret",
    }),
    ["tt1", "tt2"],
  );
  assert.deepEqual(filled, ["user@imdb.example", "secret"]);
});

test("a stuck password form is submitted once then shown", async () => {
  let fills = 0;
  let shown = 0;
  const driver: ImdbPageDriver = {
    load: async () => {},
    html: async () => '<input id="ap_email" /><input id="ap_password" />',
    titleHrefs: async () => [],
    fillLogin: async () => {
      fills += 1;
    },
    submitLogin: async () => {},
    clickSignInWithImdb: async () => false,
    clickMore: async () => false,
    scrollToEnd: async () => {},
    show: async () => {
      shown += 1;
      throw new Error("stop");
    },
    closed: () => false,
  };
  await assert.rejects(
    scrapeWatchedList(driver, { email: "a@b.c", password: "x" }),
    /stop/,
  );
  assert.equal(fills, 1);
  assert.equal(shown, 1);
});

test("an empty check-ins list is an error, not an import of nothing", async () => {
  const driver: ImdbPageDriver = {
    load: async () => {},
    html: async () => "<h1>Your Check-ins</h1>",
    titleHrefs: async () => [],
    fillLogin: async () => {},
    submitLogin: async () => {},
    clickSignInWithImdb: async () => false,
    clickMore: async () => false,
    scrollToEnd: async () => {},
    show: async () => {},
    closed: () => false,
  };
  await assert.rejects(
    scrapeWatchedList(driver, { email: "a@b.c", password: "x" }),
    /Found no titles in Your Check-ins/,
  );
});

test("a list without a next button still waits idle rounds while scrolling", async () => {
  const hrefs: string[][] = [
    ["/title/tt1/"],
    ["/title/tt1/", "/title/tt2/"],
    ["/title/tt1/", "/title/tt2/"],
    ["/title/tt1/", "/title/tt2/"],
  ];
  let scrolls = 0;
  const driver: ImdbPageDriver = {
    load: async () => {},
    html: async () => "<h1>Your Check-ins</h1>",
    titleHrefs: async () => hrefs.shift() ?? [],
    fillLogin: async () => {},
    submitLogin: async () => {},
    clickSignInWithImdb: async () => false,
    clickMore: async () => false,
    scrollToEnd: async () => {
      scrolls += 1;
    },
    show: async () => {},
    closed: () => false,
  };
  assert.deepEqual(
    await scrapeWatchedList(driver, { email: "a@b.c", password: "x" }),
    ["tt1", "tt2"],
  );
  assert.equal(scrolls >= 2, true);
});
