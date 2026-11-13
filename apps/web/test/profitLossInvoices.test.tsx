/**
 * Profit & Loss's per-invoice tab (owner ask 2026-11-13: *"add a profit per
 * invoice transaction in the sales transaction in PnL; when the transaction
 * number is clicked, it will show the invoice"*).
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
  it("lists this month's sales and opens a sale's faktur from its number", async () => {
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
    await userEvent.click(
      screen.getByRole("tab", { name: "Profit per invoice" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Open the invoice ${sale.code}`,
      }),
    );
    expect(await screen.findByText("FAKTUR PENJUALAN")).toBeTruthy();
  });
});
