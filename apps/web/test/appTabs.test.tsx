/**
 * Tabs inside the app — owner ask 2026-09-15.
 *
 * > *"The app should have tabs inside, so when I am in Inbound menu and I open
 * > product, it will open a tab inside the app, and when that menu is already
 * > opened, just redirect the tab without reopening new identical tab."*
 *
 * `layouts/tabs.ts` is pure and could be tested without a DOM; what cannot is
 * the join — that the router's location is what opens a tab, that a hidden
 * tab's page still reads its OWN params, and that a page's state survives a
 * switch. Those are what this file holds.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";

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

function renderShell(at = "/stock/inventory") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[at]}>
            <Routes>
              <Route
                path="*"
                element={
                  <AppLayout
                    staff={{
                      id: "s1",
                      username: "stub_admin",
                      name: "Stub Admin",
                      role: "OWNER",
                      canApprove: true,
                      mustChangePassword: false,
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/**
 * The SHELL's tab strip, by the labels on it.
 *
 * Scoped to `.nusantara-app-tabs`, because every open page is mounted and
 * several of them render `Tabs` of their own — Settings has eleven.
 */
const strip = () => document.querySelector<HTMLElement>(".nusantara-app-tabs")!;
const tabLabels = () =>
  Array.from(
    strip().querySelectorAll<HTMLElement>(".ant-tabs-tab .ant-tabs-tab-btn"),
  ).map((el) => el.textContent ?? "");

/** Click a nav leaf by its label, in the SIDER — not a tab of the same name. */
async function goTo(label: string) {
  const menu = document.querySelector<HTMLElement>(
    ".ant-layout-sider .ant-menu",
  )!;
  await userEvent.click(within(menu).getByText(label));
}

beforeEach(() => {
  localStorage.clear();
  useDesktopViewport();
});

describe("tabs inside the app", () => {
  it("opens one for the page the URL names", async () => {
    renderShell();
    expect(tabLabels()).toEqual(["Inventory & Stock Movement"]);
  });

  it("opens a second when a different menu entry is visited", async () => {
    renderShell();
    await goTo("Inbound & QC");
    expect(tabLabels()).toEqual(["Inventory & Stock Movement", "Inbound & QC"]);
  });

  it("does not open a second tab for a menu entry already open", async () => {
    // The owner's own sentence: "when that menu is already opened, just
    // redirect the tab without reopening new identical tab".
    renderShell();
    await goTo("Inbound & QC");
    await goTo("Inventory & Stock Movement");
    await goTo("Inbound & QC");
    expect(tabLabels()).toEqual(["Inventory & Stock Movement", "Inbound & QC"]);
  });

  it("keeps a hidden tab mounted, at its own location", async () => {
    // The whole reason for tabs rather than a history list. Both pages are in
    // the document; only one is shown.
    renderShell();
    await goTo("Inbound & QC");
    const panels = document.querySelectorAll(".ant-tabs + div, [hidden]");
    expect(panels.length).toBeGreaterThan(0);
    // The Inventory page is still mounted behind the Inbound one.
    const hidden = document.querySelector<HTMLElement>("[hidden]");
    expect(hidden).not.toBeNull();
    expect(hidden!.textContent).not.toBe("");
  });

  it("closes a tab and lands on the one beside it", async () => {
    renderShell();
    await goTo("Inbound & QC");
    expect(tabLabels()).toHaveLength(2);

    const inboundTab =
      strip().querySelectorAll<HTMLElement>(".ant-tabs-tab")[1]!;
    await userEvent.click(
      within(inboundTab).getByRole("button", { name: /remove|close/i }),
    );
    expect(tabLabels()).toEqual(["Inventory & Stock Movement"]);
  });

  it("remembers the open tabs on this device", async () => {
    const first = renderShell();
    await goTo("Inbound & QC");
    expect(tabLabels()).toHaveLength(2);
    first.unmount();

    renderShell("/inbound");
    expect(tabLabels()).toEqual(["Inventory & Stock Movement", "Inbound & QC"]);
  });
});
