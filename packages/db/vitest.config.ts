import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.js";

/**
 * Deviation from "one Vitest config for the repo" (01 §1), and the reason:
 *
 * Every test in this package runs against one real PostgreSQL database and
 * truncates it in `beforeEach` (01 §7: a mocked constraint proves nothing).
 * Vitest runs test files in parallel by default, so two files would truncate
 * each other's fixtures mid-test and fail in ways that look like flaky
 * concurrency bugs — which is exactly what this package is trying to test for
 * real. Files therefore run one at a time.
 *
 * Tests *within* a file still race deliberately; that is the point of
 * txn.test.ts.
 */
export default mergeConfig(
  root,
  defineConfig({
    test: {
      fileParallelism: false,
    },
  }),
);
