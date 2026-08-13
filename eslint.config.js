import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Read-only source from the previous build (CLAUDE.md): not linted, not
      // built, never imported.
      "reference/**",
      "docs/**",
      "secrets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Last: turns off every rule Prettier already decides.
  prettier,
);
