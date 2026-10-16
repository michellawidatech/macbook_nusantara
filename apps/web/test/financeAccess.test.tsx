/**
 * Financial & Report is for the accounts the owner named (2026-10-16: "only
 * Ersen and Dina") — `Staff.canViewFinance`. The API is what withholds the
 * money (apps/api/src/auth/financeScope.ts); this file pins the courtesy half:
 * the menu does not offer the section, and every one of its pages is behind
 * the route guard in App.tsx.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../src/layouts/AppLayout.js";
import {
  FINANCE_SECTION_KEY,
  NAV_SECTIONS,
  isFinancePath,
  navSectionsFor,
} from "../src/layouts/navigation.js";
import { PAGE_ROUTES } from "../src/pages.js";
import { FinanceLocked } from "../src/routes/finance/FinanceLocked.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import type { Staff } from "../src/lib/session.js";

function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1200,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

const staff = (canViewFinance: boolean): Staff => ({
  id: "s1",
  username: "kasir",
  name: "Kasir",
  role: "STAFF",
  canApprove: false,
  canViewFinance,
  mustChangePassword: false,
});

function renderShell(person: Staff) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/stock/opname"]}>
            <Routes>
              <Route element={<AppLayout staff={person} />}>
                <Route path="/stock/opname" element={<div />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useDesktopViewport();
});

describe("finance access", () => {
  it("does not offer Financial & Report to an account without it", () => {
    renderShell(staff(false));
    expect(screen.queryByText("Financial & Report")).toBeNull();
    expect(screen.getByText("Stock")).toBeInTheDocument();
  });

  it("offers it to an account with it", () => {
    renderShell(staff(true));
    expect(screen.getByText("Financial & Report")).toBeInTheDocument();
  });

  it("guards every page of the section, so a new leaf cannot slip past", () => {
    const section = NAV_SECTIONS.find((s) => s.key === FINANCE_SECTION_KEY)!;
    for (const leaf of section.children ?? []) {
      expect(isFinancePath(leaf.path)).toBe(true);
      expect(PAGE_ROUTES.some((r) => r.path === leaf.path)).toBe(true);
    }
    expect(navSectionsFor(staff(false)).map((s) => s.key)).not.toContain(
      FINANCE_SECTION_KEY,
    );
    expect(isFinancePath("/finances-elsewhere")).toBe(false);
  });

  it("tells a bookmark where access comes from", () => {
    render(
      <LocaleProvider>
        <FinanceLocked />
      </LocaleProvider>,
    );
    expect(
      screen.getByText("Financial & Report is restricted"),
    ).toBeInTheDocument();
  });
});
