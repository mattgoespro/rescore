import tailwindcss from "eslint-plugin-tailwindcss";
import { defineConfig } from "eslint/config";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["apps/**/*.{ts,tsx}"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Keep intentional framework and compatibility parameters in signatures.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
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
    rules: {
      ...tailwindcss.configs.recommended.rules,
      // v4 `leading-N` is spacing (rem), not a unitless multiplier. This rule
      // rewrites `leading-[1.45]` to invalid `leading-1.45`.
      "tailwindcss/no-unnecessary-arbitrary-value": "off",
    },
  },
]);
