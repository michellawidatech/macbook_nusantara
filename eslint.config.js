import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Prisma's generated client. Machine-written, gitignored, not ours to style.
      "packages/db/generated/**",
      // Read-only source from the previous build (CLAUDE.md): not linted, not
      // built, never imported.
      "reference/**",
      "docs/**",
      "secrets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore means "required by the signature, deliberately
      // unused" — Express error handlers must take four arguments to be
      // recognised as error handlers at all.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  // Last: turns off every rule Prettier already decides.
  prettier,
);
