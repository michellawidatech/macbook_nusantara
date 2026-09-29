import { defineConfig, mergeConfig } from "vitest/config";
import root from "../../vitest.config.js";

/**
 * Deviation from the single root config (01 §1), same reason as apps/api and
 * packages/db: the summary and tool suites share one real PostgreSQL and
 * truncate it between cases, so two files running in parallel would clear each
 * other's fixtures.
 *
 * The pure suites here (debounce, sanitise, the tool whitelist) touch no
 * database at all and deliberately stay that way.
 */
export default mergeConfig(
  root,
  defineConfig({ test: { fileParallelism: false } }),
);
