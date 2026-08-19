import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Testing Library only registers its own auto-cleanup when Vitest globals are
 * enabled, and this repo keeps them off (01 §1: explicit imports). Without
 * this, every render stacks up in the same document and queries start finding
 * two of everything.
 */
afterEach(() => {
  cleanup();
});
