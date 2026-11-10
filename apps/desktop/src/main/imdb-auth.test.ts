import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createImdbAuthStore } from "./imdb-auth";
import { normalizeSettings } from "../shared/settings";

const dirs: string[] = [];

function store(encrypt?: {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}) {
  const dir = mkdtempSync(join(tmpdir(), "rescore-imdb-auth-"));
  dirs.push(dir);
  return { dir, auth: createImdbAuthStore({ dir, ...encrypt }) };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("credentials round-trip in the auth file and stay out of settings", () => {
  const { dir, auth } = store();
  assert.deepEqual(auth.status(), { email: "", passwordSaved: false });
  assert.equal(auth.getCredentials(), null);
  assert.deepEqual(auth.setCredentials("user@imdb.example", "secret"), {
    email: "user@imdb.example",
    passwordSaved: true,
  });
  assert.deepEqual(auth.getCredentials(), {
    email: "user@imdb.example",
    password: "secret",
  });
  const onDisk = JSON.parse(
    readFileSync(join(dir, "imdb-auth.json"), "utf8"),
  ) as { email: string; password: string };
  assert.equal(onDisk.email, "user@imdb.example");
  assert.equal(onDisk.password, "secret");
  const settings = normalizeSettings({
    imdbPassword: "secret",
    imdbEmail: "user@imdb.example",
  } as never);
  assert.equal("imdbPassword" in settings, false);
  assert.equal("imdbEmail" in settings, false);
});

test("encrypted passwords round-trip and an empty password keeps the saved one", () => {
  const { auth } = store({
    encrypt: (plain) => `enc:${plain}`,
    decrypt: (stored) => stored.replace(/^enc:/, ""),
  });
  auth.setCredentials("a@b.c", "one");
  assert.equal(auth.getCredentials()?.password, "one");
  auth.setCredentials("new@b.c", "");
  assert.deepEqual(auth.getCredentials(), {
    email: "new@b.c",
    password: "one",
  });
  assert.equal(auth.status().passwordSaved, true);
});

test("empty email and password remove the saved credentials", () => {
  const { dir, auth } = store();
  auth.setCredentials("a@b.c", "secret");
  assert.deepEqual(auth.setCredentials("", ""), {
    email: "",
    passwordSaved: false,
  });
  assert.equal(auth.getCredentials(), null);
  assert.equal(existsSync(join(dir, "imdb-auth.json")), false);
});
