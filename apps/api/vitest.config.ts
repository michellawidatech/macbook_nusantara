import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.js";

/**
 * Deviation from the single root config (01 §1), same reason as packages/db:
 * these tests share one real PostgreSQL and truncate it between cases, so two
 * files running in parallel would clear each other's fixtures.
 */
export default mergeConfig(
  root,
  defineConfig({ test: { fileParallelism: false } }),
);
