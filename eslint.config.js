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
          // `const { sortValue, ...rest } = col` is how a wrapper strips its own
          // props before spreading what is left onto a third-party component.
          // The named siblings are the point of the statement, not an oversight,
          // so naming them must not require renaming them.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Last: turns off every rule Prettier already decides.
  prettier,
);
