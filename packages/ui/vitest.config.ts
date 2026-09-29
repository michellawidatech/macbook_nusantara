import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Same standalone config as apps/web, same reason (01 §1, deviation noted):
 * jsdom + the React plugin cannot be merged onto the root's plain config.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    setupFiles: ["./test/setup.ts"],
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, "reference/**"],
  },
});
