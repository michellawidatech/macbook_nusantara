/**
 * The phone's bottom tabs and More screen (owner-approved mockup,
 * 2026-11-16): Sell · Stock · Sales · Chat · More, each an icon and a word,
 * and a More screen holding everything that is not a tab.
 *
 * `test/setup.ts` answers "no" to every media query, so the shell renders its
 * phone form here without being asked.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { activeTab, tabsFor } from "../src/layouts/BottomTabBar.js";
import { MorePage } from "../src/routes/MorePage.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import type { Staff } from "../src/lib/session.js";

const owner: Staff = {
  id: "s1",
  username: "ersen",
  name: "Ersen Tan",
  role: "OWNER",
  canApprove: false,
  canViewFinance: true,
  mustChangePassword: false,
};

function renderShell(staff: Staff, at = "/stock/inventory") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[at]}>
            <Routes>
              <Route element={<AppLayout staff={staff} />}>
                <Route
                  path="/stock/inventory"
                  element={<div>The inventory page</div>}
                />
                <Route path="/stock/out" element={<div>The till</div>} />
                <Route path="/inbound" element={<div>Inbound</div>} />
                <Route path="/more" element={<MorePage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const tabBar = () => screen.getByRole("navigation", { name: /^(Main|Utama)$/ });

beforeEach(() => localStorage.clear());

describe("which tab is lit", () => {
  it("lights the four places and anything under them, and More for the rest", () => {
    expect(activeTab("/stock/out")).toBe("sell");
    expect(activeTab("/stock/inventory")).toBe("stock");
    expect(activeTab("/finance/transactions")).toBe("sales");
    expect(activeTab("/chat")).toBe("chat");
    expect(activeTab("/inbound/po-1")).toBe("more");
    expect(activeTab("/stock/opname")).toBe("more");
    expect(activeTab("/more")).toBe("more");
  });

  it("offers Sales only to an account with finance access", () => {
    expect(tabsFor({ canViewFinance: true })).toEqual([
      "sell",
      "stock",
      "sales",
      "chat",
      "more",
    ]);
    expect(tabsFor({ canViewFinance: false })).not.toContain("sales");
  });
});

describe("the tab bar", () => {
  it("is five links with a word each, and no hamburger header", () => {
    renderShell(owner);
    const links = within(tabBar()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Sell",
      "Stock",
      "Sales",
      "Chat",
      "More",
    ]);
    expect(
      within(tabBar()).getByRole("link", { name: "Stock" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Open navigation")).toBeNull();
    expect(document.querySelector(".ant-layout-sider")).toBeNull();
  });

  it("drops Sales for an account without finance access", () => {
    renderShell({ ...owner, canViewFinance: false });
    expect(within(tabBar()).queryByRole("link", { name: "Sales" })).toBeNull();
    expect(within(tabBar()).getAllByRole("link")).toHaveLength(4);
  });

  it("goes where it says", async () => {
    renderShell(owner);
    await userEvent.click(within(tabBar()).getByRole("link", { name: "Sell" }));
    expect(await screen.findByText("The till")).toBeInTheDocument();
    expect(
      within(tabBar()).getByRole("link", { name: "Sell" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

describe("More", () => {
  it("lists the places that are not tabs, grouped as the desktop menu is", async () => {
    renderShell(owner, "/more");
    expect(await screen.findByText("Ersen Tan")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    const stock = screen.getByRole("navigation", { name: "Stock" });
    const rows = within(stock)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(rows[0]).toMatch(/^Inbound & QC/);
    // The till and Inventory are tabs, so they are not rows here.
    expect(rows.join("|")).not.toMatch(/New Transaction|Inventory/);
    const finance = screen.getByRole("navigation", {
      name: "Financial & Report",
    });
    // Transaction History is the Sales tab.
    expect(within(finance).queryByText("Transaction History")).toBeNull();
    expect(within(finance).getByText("Receivable")).toBeInTheDocument();
    // The leaf sections — Customer, Supplier, Settings.
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    // The chatbot is a tab.
    expect(screen.queryByRole("link", { name: "Chatbot" })).toBeNull();
    expect(
      within(tabBar()).getByRole("link", { name: "More" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps finance out for an account without access, and Transaction History out of More either way", () => {
    renderShell({ ...owner, canViewFinance: false }, "/more");
    expect(
      screen.queryByRole("navigation", { name: "Financial & Report" }),
    ).toBeNull();
    expect(screen.queryByText("Transaction History")).toBeNull();
  });

  it("spells out appearance and language, and signs out in words", () => {
    renderShell(owner, "/more");
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Bahasa Indonesia")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sign out/ }),
    ).toBeInTheDocument();
  });

  it("switches the language from More, and the tabs follow", async () => {
    renderShell(owner, "/more");
    await userEvent.click(screen.getByText("Bahasa Indonesia"));
    expect(
      await within(tabBar()).findByRole("link", { name: "Jual" }),
    ).toBeInTheDocument();
    expect(
      within(tabBar()).getByRole("link", { name: "Lainnya" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
