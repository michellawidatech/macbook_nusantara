/**
 * Profit per invoice, on the statement (owner ask 2026-11-13, combined into
 * the Statement tab 2026-11-16): the Sales line's transactions carry each
 * invoice's profit, and a transaction number opens its faktur.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProfitLossPage } from "../src/routes/finance/ProfitLossPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

describe("profit per invoice", () => {
  it("shows a sale's profit beside its lines and opens its faktur from its number", async () => {
    // A sale of today, so the month the page opens on always has one.
    const base = getDb().orders.find((o) => o.serials.length > 0)!;
    const sale = {
      ...structuredClone(base),
      id: "o-pnl-invoice",
      code: "SI-PNL-INVOICE",
      ts: new Date().toISOString(),
    } as Order;
    mutate((d) => {
      d.orders.push(sale);
    });
    render(
      <AntdApp>
        <MemoryRouter>
          <ProfitLossPage />
        </MemoryRouter>
      </AntdApp>,
    );
    // The tab is gone; the statement's Sales line is where it lives.
    expect(
      screen.queryByRole("tab", { name: "Profit per invoice" }),
    ).toBeNull();
    await userEvent.click(screen.getByText("Sales"));
    // A scrolling table draws its header twice; one is enough.
    expect(
      (await screen.findAllByText("Invoice profit")).length,
    ).toBeGreaterThan(0);
    // By its text, not a role query: the transactions list has no pages,
    // and a role query over every row of the month takes minutes in jsdom.
    const [number] = await screen.findAllByText(sale.code);
    const button = number!.closest("button")!;
    expect(button.getAttribute("aria-label")).toBe(
      `Open the invoice ${sale.code}`,
    );
    await userEvent.click(button);
    expect(await screen.findByText("FAKTUR PENJUALAN")).toBeTruthy();
  });
});
