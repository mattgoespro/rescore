import reactHooks from "eslint-plugin-react-hooks";
import tailwindcss from "eslint-plugin-tailwindcss";
import { defineConfig } from "eslint/config";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

// Each guard below stops a class of defect that review passes kept finding.
// `no-restricted-syntax` takes one list per file, so the lists are composed.

const PROSE_CATALOG =
  "/\\s[Cc]atalog(?=[\\s,;!?)…]|\\.(?!\\w)|$)|^[Cc]atalog\\s/";

/** Every source file: text people read. */
const textGuards = [
  {
    selector:
      "Literal[value=/\\uFFFD/], TemplateElement[value.raw=/\\uFFFD/], JSXText[value=/\\uFFFD/]",
    message:
      "U+FFFD is a broken character from a bad encoding round trip. Type the intended character (for example …).",
  },
  {
    // Prose only, so the word sits beside a space. Bare values ("catalog"),
    // channels (catalog:status), routes (/v1/catalog) and files
    // (catalog.sqlite) are identifiers and keep their spelling.
    selector: `Literal[value=${PROSE_CATALOG}], TemplateElement[value.raw=${PROSE_CATALOG}], JSXText[value=${PROSE_CATALOG}]`,
    message:
      "Text people read says catalogue. Identifiers, routes and file names keep catalog (AGENTS.md).",
  },
];

/** Renderer components: theming, semantics and background work. */
const rendererGuards = [
  {
    selector:
      "CallExpression[callee.name='setInterval'], CallExpression[callee.property.name='setInterval']",
    message:
      "Poll with pollWhileVisible (lib/poll-while-visible) so a hidden window stops polling.",
  },
  {
    selector:
      "JSXOpeningElement[name.name='button']:not(:has(JSXAttribute[name.name='type']))",
    message: 'Give every <button> an explicit type="button" or type="submit".',
  },
  {
    selector:
      "JSXElement[openingElement.name.name='button'] JSXOpeningElement[name.name=/^h[1-6]$/]",
    message:
      "A heading inside a button breaks the outline; use a span with the heading's classes.",
  },
  {
    selector:
      "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?|oklch)\\(/], TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?|oklch)\\(/]",
    message:
      "Colours come from the --imd-* theme tokens (styles/theme.css) so both themes follow them.",
  },
];

export default defineConfig([
  {
    files: ["apps/**/*.{ts,tsx}"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Keep intentional parameters and fields omitted through object rest.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...textGuards] },
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // No ref reads or writes during render; effects and events only.
      "react-hooks/refs": "error",
      "no-restricted-syntax": ["error", ...textGuards, ...rendererGuards],
    },
  },
  {
    // The one place an interval is allowed: the helper the rule points to.
    files: ["apps/desktop/src/renderer/src/lib/poll-while-visible.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...textGuards],
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      // CommonJS entry points are also loaded by Electron Builder through require.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["node_modules", "**/out", "apps/**/*.js"],
  },
  {
    ...tailwindcss.configs.recommended,
    settings: {
      tailwindcss: {
        cssConfigPath: fileURLToPath(
          new URL(
            "./apps/desktop/src/renderer/src/styles/index.css",
            import.meta.url,
          ),
        ),
      },
    },
  },
]);
