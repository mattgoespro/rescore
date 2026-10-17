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
      // Keep intentional parameters and fields omitted through object rest.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
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
