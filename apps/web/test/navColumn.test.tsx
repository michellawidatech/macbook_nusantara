/**
 * The nav column — the sections a person opens, and the rail.
 *
 * > *"Make the navigation bar have to be collapsible manually instead of
 * > dynamic accordion, you can remove the bubble UI."* (owner ask 2026-09-15)
 *
 * This file was `navGlass.test.tsx` and held the 2026-09-09 treatment: a
 * gradient column carrying two floating translucent panels. The panels are the
 * bubble UI the owner asked to remove, so the assertions about them are gone
 * rather than inverted — a test that a thing is absent is a test somebody will
 * delete the day it comes back for a good reason. The gradient stayed, and so
 * does its test: it is what the column looks like, and removing it would be
 * the revamp the owner asked twice not to have.
 *
 * What is here instead is the behaviour the ask is about, which is a
 * behaviour rather than a style: a section stays as it was left, and the
 * column collapses when — and only when — somebody says so.
 *
 * jsdom does not paint, so nothing here claims the column LOOKS right.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import { getDb, mutate } from "../src/mock/store.js";
import { qcWaitingCount } from "../src/lib/qcWaiting.js";

/**
 * Force the desktop layout.
 *
 * `test/setup.ts` answers "no" to every media query, so without this the shell
 * renders its phone form — which has no sider at all, and the panels this file
 * is about are the sider's.
 */
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

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/stock/opname"]}>
            <Routes>
              <Route
                element={
                  <AppLayout
                    staff={{
                      id: "s1",
                      username: "stub_admin",
                      name: "Stub Admin",
                      role: "OWNER",
                      canApprove: true,
                      canViewFinance: true,
                      mustChangePassword: false,
                    }}
                  />
                }
              >
                <Route path="/stock/opname" element={<div />} />
                <Route
                  path="/stock/inventory"
                  element={<div>The inventory page</div>}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** Which submenus the nav currently has open, by their label. */
const openSections = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".ant-menu-submenu-open"),
  ).map((el) => el.querySelector(".ant-menu-submenu-title")?.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  useDesktopViewport();
});

describe("the nav column", () => {
  it("paints the column with a gradient", () => {
    renderShell();
    const sider = document.querySelector<HTMLElement>(".ant-layout-sider");
    expect(sider!.style.background).toContain("linear-gradient");
  });

  it("carries no floating panel — the bubble UI is gone (2026-09-15)", () => {
    renderShell();
    // Two translucent cards inside a coloured column is a lot of frame for a
    // list of eleven links, and the frame competed with the selected pill.
    expect(
      document.querySelectorAll('[style*="backdrop-filter"]'),
    ).toHaveLength(0);
  });

  it("keeps the mark and the menu together", () => {
    renderShell();
    expect(screen.getByText("Macbook Nusantara")).toBeTruthy();
    expect(document.querySelector(".ant-menu")).not.toBeNull();
  });

  it("opens the section the current route lives in", () => {
    // `/stock/opname` is a leaf of Stock, so Stock opens by itself — the one
    // thing that still opens a section without being asked.
    renderShell();
    expect(openSections()).toContain("Stock");
  });

  it("leaves a second section open once somebody opens it", async () => {
    // The accordion this replaces kept `keys.slice(-1)`, so opening one
    // section closed the other and walking between two meant reopening one
    // every time.
    renderShell();
    await userEvent.click(screen.getByText("Financial & Report"));
    const open = openSections();
    expect(open).toContain("Financial & Report");
    expect(open).toContain("Stock");
  });

  it("collapses to a rail only when asked, and comes back", async () => {
    renderShell();
    expect(screen.getByText("Macbook Nusantara")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Collapse the menu" }),
    );
    // The wordmark goes with the width: 48px is one icon wide.
    expect(screen.queryByText("Macbook Nusantara")).toBeNull();
    expect(
      document.querySelector(".ant-layout-sider-collapsed"),
    ).not.toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Expand the menu" }),
    );
    expect(screen.getByText("Macbook Nusantara")).toBeTruthy();
  });

  it("makes every place a link, so it can be dragged into another tab", () => {
    // Owner ask 2026-09-21: "remove the tab view but the user must be able
    // to drag the feature and open it in another tab". A browser drags, and
    // cmd- or middle-clicks, an `<a href>` — never a row that only navigates.
    renderShell();
    expect(screen.getByRole("link", { name: "Stock Opname" })).toHaveAttribute(
      "href",
      "/stock/opname",
    );
    expect(screen.getByRole("link", { name: "Customer" })).toHaveAttribute(
      "href",
      "/customers",
    );
    // The Stock entry and the white button above the account foot, which is
    // the same place on purpose (2026-09-01) — both draggable.
    const till = screen.getAllByRole("link", { name: /New Transaction/ });
    expect(till).toHaveLength(2);
    for (const link of till) expect(link).toHaveAttribute("href", "/stock/out");
  });

  it("still goes there on a plain click, and draws no tab strip", async () => {
    renderShell();
    expect(document.querySelector(".nusantara-app-tabs")).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Inventory" }));
    expect(await screen.findByText("The inventory page")).toBeTruthy();
  });

  it("remembers the rail on this device", async () => {
    // A preference about a desk, not about a person — so `localStorage`,
    // beside the scanner's. See `hooks/usePersistentState.ts`.
    const first = renderShell();
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse the menu" }),
    );
    first.unmount();

    renderShell();
    expect(
      document.querySelector(".ant-layout-sider-collapsed"),
    ).not.toBeNull();
  });

  it("counts the units waiting for QC on Inbound & QC, and nothing at zero", async () => {
    // Owner ask 2026-10-26: which units are not QCed yet, visible from any
    // screen. Inbound & QC is under Stock, which the route opens.
    mutate((d) => {
      const po = d.pos[0]!;
      d.units.push({
        serial: "C02NAVBADGE1",
        skuId: d.skus[0]!.id,
        status: "QC",
        locationId: po.locationId,
        buy: 1_000_000,
        description: "",
        poId: po.id,
      });
    });
    const waiting = qcWaitingCount(getDb());
    expect(waiting).toBeGreaterThan(0);
    const first = renderShell();
    const link = screen.getByRole("link", { name: /^Inbound & QC/ });
    const badge = link.querySelector('[data-nav-badge="qcWaiting"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain(String(waiting));
    expect(
      badge!.querySelector(`[title="${waiting} unit(s) waiting for QC"]`),
    ).not.toBeNull();
    first.unmount();

    // A caught-up bench: no units in QC on an invoice, no box unscanned.
    mutate((d) => {
      d.units = d.units.filter((u) => u.status !== "QC" || u.poId === null);
      for (const po of d.pos) {
        if (po.status === "RECEIVED") po.status = "ORDERED";
      }
    });
    renderShell();
    expect(
      screen
        .getByRole("link", { name: /^Inbound & QC/ })
        .querySelector('[data-nav-badge="qcWaiting"]'),
    ).toBeNull();
  });
});
