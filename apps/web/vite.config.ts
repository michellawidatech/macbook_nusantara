import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 01 §2: web on :3000, api on :4000. The proxy keeps the SPA same-origin in
// development, so the session cookie behaves exactly as it will in production
// behind one nginx — SameSite=Lax on a cross-origin dev setup would not.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Components copied from xinchuan call react-i18next; this build is
      // English-only, so a tiny shim interpolates their inline defaults.
      "react-i18next": new URL("./src/i18n/shim.ts", import.meta.url).pathname,
    },
  },
  server: {
    port: 3000,
    // A neighbouring project squatting on :3000 must fail loudly rather than
    // silently move to :3001 and confuse a "missing route" hunt (CLAUDE.md).
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
});
