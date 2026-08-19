import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans with Vitest globals on; this repo keeps
// them off, so clean explicitly (same note as apps/web).
afterEach(() => {
  cleanup();
});

// Vitest's jsdom environment copies a fixed list of globals to the worker and
// localStorage is not on it. The kit's persistence contracts (table prefs,
// drafts) are exactly what these tests exist to prove, so provide a real
// in-memory Storage instead of skipping them.
if (globalThis.localStorage === undefined) {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}
