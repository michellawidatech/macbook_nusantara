/**
 * A customer's debt from before this app, on the two screens that chase money
 * (owner answer 2026-09-13: receivables "need to combine all").
 *
 * B2Soft left ten customers owing money that no invoice explains, and the
 * migration stores it as `Customer.openingBalance`. What these pin: Receivables
 * lists it as its own row and counts it in what customers owe, and Customers
 * adds it to that person's balance. Neither screen invents a sale for it.
 */
import type { ReactNode } from "react";
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CustomersPage } from "../src/routes/customers/CustomersPage.js";
import { ReceivablePage } from "../src/routes/finance/PayableReceivablePage.js";
import { fmtRp } from "../src/lib/format.js";
import { customerBalance } from "../src/lib/salePayments.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

const OLD_DEBT = 41_500_000;

function oweFromBefore() {
  const id = getDb().customers[0]!.id;
  void mutate((d) => {
    const c = d.customers.find((x) => x.id === id)!;
    c.openingBalance = OLD_DEBT;
    c.openingBalanceAt = "2026-09-10T01:00:00.000Z";
  });
  return getDb().customers.find((x) => x.id === id)!;
}

const page = (ui: ReactNode) =>
  render(
    <AntdApp>
      <MemoryRouter>{ui}</MemoryRouter>
    </AntdApp>,
  );

describe("a debt from before this app", () => {
  it("is its own row on Receivable", async () => {
    // Pending Payment is marketplace money alone since 2026-09-23 (owner ask),
    // so what a customer owes — including a debt no invoice explains — is read
    // on Receivable and nowhere else.
    const customer = oweFromBefore();
    page(<ReceivablePage />);
    expect(await screen.findByText("From before this app")).toBeTruthy();
    expect(screen.getAllByText(customer.name).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText((text) => text.includes(fmtRp(OLD_DEBT))).length,
    ).toBeGreaterThan(0);
  });

  it("is in the customer's balance on Customers", async () => {
    const customer =
      getDb().customers.find((c) => c.openingBalance) ?? oweFromBefore();
    const owed = customerBalance(
      customer.id,
      getDb().orders,
      customer.openingBalance,
    ).owed;
    expect(owed).toBeGreaterThanOrEqual(OLD_DEBT);
    page(<CustomersPage />);
    expect((await screen.findAllByText(fmtRp(owed))).length).toBeGreaterThan(0);
  });
});
