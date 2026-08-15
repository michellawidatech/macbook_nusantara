import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Deviation from the single root config (01 §1), and the reason:
 *
 * This is the only project that renders in a browser, so it needs jsdom, the
 * React plugin and a setup file. It cannot `mergeConfig` the root one, because
 * the root exports a plain Vitest config and merging it with a plugin array
 * does not typecheck — so the two shared settings are restated here instead of
 * being inherited. If the root config gains a setting that matters to the web,
 * it must be copied here too.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // jsdom disables localStorage on an opaque origin, which about:blank is.
    // The app stores the language preference there, so give it a real origin.
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    setupFiles: ["./test/setup.ts"],
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, "reference/**"],
  },
});
