import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Tailwind 4 emits a `--color-*` variable only for colours declared in an
// `@theme` block; the palette in tailwind.config.mts and `@theme inline`
// values become literal utilities. A `var()` naming one of those resolves to
// nothing, and its whole declaration (a shadow, a background) silently drops.

const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(css|tsx?)$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

test("every CSS variable the renderer reads is defined", () => {
  const files = sources(root).map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
  const defined = new Set<string>();
  for (const { path, text } of files) {
    const emitted = path.endsWith(".css")
      ? text.replace(/@theme inline\s*\{[^}]*\}/g, "")
      : text;
    const pattern = path.endsWith(".css")
      ? /(--[\w-]+)\s*:/g
      : /["'](--[\w-]+)["']/g;
    for (const [, name] of emitted.matchAll(pattern)) defined.add(name!);
  }
  const missing = files.flatMap(({ path, text }) =>
    [...text.matchAll(/var\((--[\w-]+)/g)]
      .map(([, name]) => name!)
      .filter((name) => !name.startsWith("--tw-") && !defined.has(name))
      .map((name) => `${name} in ${path.slice(root.length + 1)}`),
  );
  assert.deepEqual(missing, []);
});
