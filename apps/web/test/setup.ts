import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * Testing Library only registers its own auto-cleanup when Vitest globals are
 * enabled, and this repo keeps them off (01 §1: explicit imports). Without
 * this, every render stacks up in the same document and queries start finding
 * two of everything.
 */
afterEach(() => {
  cleanup();
});

/**
 * A real `localStorage`, because neither jsdom nor Node provides a usable one
 * here.
 *
 * Node 26 defines a built-in `localStorage` global that is unavailable unless
 * the process was started with `--localstorage-file`, and it takes the name
 * before jsdom's own can be installed — so `window.localStorage` and
 * `globalThis.localStorage` are both `undefined`, whatever origin
 * `environmentOptions.jsdom.url` gives the document.
 *
 * The app survives that on its own: `LocaleProvider` and `ThemeProvider` both
 * read and write inside `try/catch` precisely because a browser can refuse
 * (Safari throws in private browsing). But "the preference silently does not
 * persist" is exactly what those tests exist to catch, so a test run without a
 * store would pass while asserting nothing.
 */
class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  clear() {
    this.#items.clear();
  }
}

// `configurable` so a test that wants to simulate a throwing store can replace
// it; a plain assignment would fail against Node's own getter-only definition.
beforeEach(() => {
  const storage = new MemoryStorage();
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

/**
 * `window.matchMedia`, which jsdom does not implement at all.
 *
 * antd reaches for it in two places this app depends on: `Grid.useBreakpoint`
 * (behind `useLayoutMode`, so every component that renders differently on a
 * phone) and its own responsive observers. Without a stub, rendering any of
 * them throws before a single assertion runs.
 *
 * It answers "no" to every query, which lands the tests on the desktop layout
 * — the same default a component gets on antd's first render pass, since
 * `useBreakpoint` returns an empty record until its layout effect commits.
 */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
});

/**
 * `ResizeObserver`, which jsdom does not implement either.
 *
 * antd's floating layers — Dropdown, Select, DatePicker, Tooltip — all sit on
 * rc-trigger, which observes its anchor so the layer can follow it. Opening any
 * of them in a test throws `ResizeObserver is not defined` before the menu
 * exists to assert on.
 *
 * A no-op is the right stub rather than something that measures: jsdom lays
 * nothing out, so every box is 0×0 and a "real" implementation would only
 * report that more slowly.
 */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: NoopResizeObserver,
  configurable: true,
  writable: true,
});

/**
 * No test may reach the network.
 *
 * Pages fetch now (reservations first, more to follow). Without this, a test
 * that forgets to stub its API module makes a real request to a relative URL —
 * which in jsdom is an obscure failure a long way from its cause, or worse, a
 * hang. Failing loudly and immediately is the point.
 */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(
    `Unstubbed fetch in a test: ${String(input)}. Mock the API client module ` +
      `for this page, the way test/reservationsPage.test.tsx does.`,
  );
}) as typeof globalThis.fetch;

