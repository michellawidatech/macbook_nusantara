/**
 * Today (owner ask 2026-11-13): the approver's morning screen — restock, the
 * bank and whether it is reconciled, requests waiting, every unit in stock.
 */
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";
import { TodayPage } from "../src/routes/today/TodayPage.js";
import { TodayApprovalsCard } from "../src/routes/today/TodayApprovalsCard.js";
import { sessionKey, type Staff } from "../src/lib/session.js";
import {
  NAV_SECTIONS,
  TODAY_SECTION_KEY,
  navSectionsFor,
} from "../src/layouts/navigation.js";
import { PAGE_ROUTES } from "../src/pages.js";
import { getDb } from "../src/mock/store.js";
import { needsRestock } from "../src/lib/restock.js";
import { todayStockRows } from "../src/lib/todayStock.js";
import { balancesOfRows, cashflowRows } from "../src/lib/cashflowRows.js";
import { unreconciledPots } from "../src/lib/reconciliation.js";
import { fmtRp } from "../src/lib/format.js";

vi.setConfig({ testTimeout: 90_000 });

const person = (over: Partial<Staff> = {}): Staff => ({
  id: "s1",
  username: "ersen",
  name: "Ersen",
  role: "OWNER",
  canApprove: true,
  canViewFinance: true,
  mustChangePassword: false,
  ...over,
});

function renderToday(staff: Staff) {
  const qc = new QueryClient();
  qc.setQueryData(sessionKey, staff);
  return render(
    <QueryClientProvider client={qc}>
      <AntdApp>
        <MemoryRouter initialEntries={["/today"]}>
          <TodayPage />
        </MemoryRouter>
      </AntdApp>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

describe("who sees Today", () => {
  it("is the first section, offered only to an account that approves edits", () => {
    expect(NAV_SECTIONS[0]?.key).toBe(TODAY_SECTION_KEY);
    expect(PAGE_ROUTES.some((r) => r.path === "/today")).toBe(true);
    expect(
      navSectionsFor({ canViewFinance: true, canApprove: true })[0]?.key,
    ).toBe(TODAY_SECTION_KEY);
    expect(
      navSectionsFor({ canViewFinance: true, canApprove: false }).map(
        (s) => s.key,
      ),
    ).not.toContain(TODAY_SECTION_KEY);
  });

  it("refuses an account that does not approve edits, without naming anybody", async () => {
    renderToday(person({ canApprove: false }));
    await settle();
    expect(screen.getByText("Today is restricted")).toBeInTheDocument();
    expect(screen.queryByTestId("today-restock")).toBeNull();
  });
});

describe("the approver's page", () => {
  it("lists what needs restocking by the 30-day rule", async () => {
    renderToday(person());
    await settle();
    const card = screen.getByTestId("today-restock");
    const expected = needsRestock(getDb());
    if (expected.length === 0) {
      expect(card).toHaveTextContent(
        "Nothing sold in the last 30 days is running short.",
      );
    } else {
      for (const r of expected.slice(0, 6)) {
        const row = card.querySelector(`[data-restock="${r.skuId}"]`);
        expect(row).toHaveTextContent(`${r.onHand} on hand · ${r.sold} sold`);
      }
    }
  });

  it("shows today's bank balance behind the eye, and whether today's bank is reconciled", async () => {
    renderToday(person());
    await settle();
    const card = screen.getByTestId("today-bank");
    expect(within(card).getByTestId("today-bank-amount")).toHaveTextContent(
      "Rp ••••••",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "Show the bank balance" }),
    );
    const db = getDb();
    const bank = balancesOfRows(
      cashflowRows(db, ((_k: string, v: string) => v) as never),
      db.settings,
    ).bank;
    expect(within(card).getByTestId("today-bank-amount")).toHaveTextContent(
      fmtRp(bank),
    );
    const reconciled = !unreconciledPots(
      db,
      dayjs().format("YYYY-MM-DD"),
    ).includes("BANK");
    expect(card).toHaveTextContent(
      reconciled ? "Reconciled today" : "Not reconciled today",
    );
  });

  it("leaves the bank out for an approver without finance access", async () => {
    renderToday(person({ canViewFinance: false }));
    await settle();
    expect(screen.queryByTestId("today-bank")).toBeNull();
    expect(screen.getByTestId("today-restock")).toBeInTheDocument();
    expect(screen.getByTestId("today-approvals")).toHaveTextContent(
      "Nothing is waiting for you.",
    );
  });

  it("lists every unit in stock and finds one by its serial; counted products are quantities", async () => {
    renderToday(person());
    await settle();
    const rows = todayStockRows(getDb());
    const unit = rows.find((r) => r.kind === "UNIT")!;
    await userEvent.type(
      screen.getByPlaceholderText("Search product or serial"),
      unit.serial!,
    );
    await settle();
    expect(screen.getAllByText(unit.serial!).length).toBeGreaterThan(0);
    // A sold unit is not in stock.
    const sold = getDb().units.find((u) => u.status === "TERJUAL");
    if (sold) expect(rows.some((r) => r.serial === sold.serial)).toBe(false);
    const counted = rows.find((r) => r.kind === "COUNTED");
    if (counted) {
      expect(counted.serial).toBeUndefined();
      expect(counted.qty).toBeGreaterThan(0);
    }
  });
});

describe("Waiting for your approval", () => {
  it("lists the requests newest first with who and why, and links to Approvals", () => {
    render(
      <MemoryRouter>
        <TodayApprovalsCard
          requests={[
            {
              id: "1",
              code: "CR-0001",
              kind: "EDIT",
              label: "SI-2026/11-0004",
              note: "Wrong price typed",
              requestedByName: "Dina",
              requestedAt: "2026-11-12T03:00:00.000Z",
            },
            {
              id: "2",
              code: "CR-0002",
              kind: "DELETE",
              label: "PI-2026/11-0002",
              note: "Entered twice",
              requestedByName: "Ririn",
              requestedAt: "2026-11-13T03:00:00.000Z",
            },
          ]}
        />
      </MemoryRouter>,
    );
    const card = screen.getByTestId("today-approvals");
    const rows = card.querySelectorAll("[data-request]");
    expect(Array.from(rows).map((r) => r.getAttribute("data-request"))).toEqual(
      ["CR-0002", "CR-0001"],
    );
    expect(rows[0]).toHaveTextContent("Delete");
    expect(rows[0]).toHaveTextContent("Entered twice");
    expect(rows[0]).toHaveTextContent("Ririn");
    expect(rows[1]).toHaveTextContent("Edit");
    expect(
      within(card).getByRole("link", { name: "Open Approvals" }),
    ).toHaveAttribute("href", "/finance/approvals");
  });
});
