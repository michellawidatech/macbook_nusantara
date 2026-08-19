import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.js";

/**
 * Deviation from "one Vitest config for the repo" (01 §1), and the reason:
 *
 * `packages/domain` is the only project with a coverage requirement — S3's
 * Definition of Done is 100% branch coverage, because this is the pure layer
 * where a missed branch is a silently wrong number rather than a crash. Putting
 * that threshold in the root config would fail every other project, which ships
 * no tests yet by design.
 *
 * Everything else is inherited, so the runner stays configured once.
 */
export default mergeConfig(
  root,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        // Barrel file: re-exports only, nothing to cover.
        exclude: ["src/index.ts"],
        reporter: ["text-summary"],
        thresholds: {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  }),
);
