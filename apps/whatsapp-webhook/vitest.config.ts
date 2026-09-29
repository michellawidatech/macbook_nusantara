import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.js";

/**
 * Deviation from the single root config (01 §1), same reason as apps/api:
 * app.test.ts drives a real PostgreSQL and clears its own rows between cases,
 * so two files running in parallel would delete each other's fixtures.
 */
export default mergeConfig(
  root,
  defineConfig({ test: { fileParallelism: false } }),
);
