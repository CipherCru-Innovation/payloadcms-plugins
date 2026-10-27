import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/**", "**/node_modules/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  /* A plugin runs inside someone else's Payload project, so it may not reach into one. */
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/*"], message: "A plugin cannot import its host." }] },
      ],
    },
  },
]);
