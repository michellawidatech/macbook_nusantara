import { configDefaults, defineConfig } from "vitest/config";

/**
 * The single Vitest configuration for the whole repo. Every workspace project
 * points its `test` script at this file (`vitest run --config ../../vitest.config.ts`),
 * so the runner is configured once and each project keeps its own directory as
 * the test root.
 */
export default defineConfig({
  test: {
    environment: "node",
    // The skeleton ships zero tests, and `pnpm -r test` must stay green for a
    // project until it grows its first one.
    passWithNoTests: true,
    exclude: [
      ...configDefaults.exclude,
      // Read-only source from the previous build — never built, never run.
      "reference/**",
    ],
  },
});
