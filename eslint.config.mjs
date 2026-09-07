import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["apps/**/*.{ts,tsx}"],
  },
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules", "**/out/**"],
  },
]);
