/**
 * Add payment on Payable and Receivable, driven the way the desk drives it
 * (owner ask 2026-09-22). The arithmetic is `test/allocatePayment.test.ts`;
 * what this pins is that the dialog writes what it shows — and the owner's own
 * example, 10jt over bills of 5, 2, 4, 2 and 1jt, end to end.
 */
import type { ReactNode } from "react";
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PayablePage,
  ReceivablePage,
} from "../src/routes/finance/PayableReceivablePage.js";
import { customerDebtOf } from "../src/lib/payableReceivable.js";
import { fmtRp } from "../src/lib/format.js";
import { poTotals } from "../src/lib/inbound.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { Po } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 60_000 });

const JT = 1_000_000;
const SUP = "sup-alloc-test";

const page = (ui: ReactNode) =>
  render(
    <AntdApp>
      <MemoryRouter>{ui}</MemoryRouter>
    </AntdApp>,
  );

function invoice(id: string, day: string, amount: number): Po {
  return {
    id,
    code: id.toUpperCase(),
    supplierId: SUP,
    invoice: "",
    date: `2026-09-${day}T00:00:00.000Z`,
    locationId: getDb().warehouses[0]!.id,
    items: [
      {
        id: `${id}-l`,
        skuId: getDb().skus[0]!.id,
        serial: null,
        qty: 1,
        unitCost: amount,
      },
    ],
    payments: [],
    fees: [],
    discount: 0,
    status: "RECEIVED",
  } as Po;
}

beforeEach(async () => {
  // One supplier owing exactly the owner's example: an old debt of 5jt, then
  // invoices of 2, 4, 2 and 1jt. Nobody else has an old debt, so the row
  // buttons below are unambiguous.
  if (getDb().suppliers.some((s) => s.id === SUP)) return;
  await mutate((d) => {
    for (const s of d.suppliers) delete s.openingBalance;
    d.suppliers.push({
      id: SUP,
      name: "Toko Uji Alokasi",
      openingBalance: 5 * JT,
      openingBalanceAt: "2026-08-01T00:00:00.000Z",
    });
    d.pos.push(
      invoice("pi-a1", "02", 2 * JT),
      invoice("pi-a2", "03", 4 * JT),
      invoice("pi-a3", "04", 2 * JT),
      invoice("pi-a4", "05", 1 * JT),
    );
  });
});

/** The dialog, found by its title (two antd dialogs share one label id). */
const dialogTitled = async (title: string) =>
  (await screen.findByText(title)).closest("[role='dialog']") as HTMLElement;

describe("Pay a supplier", () => {
  it("spreads 10jt oldest first and writes exactly that", async () => {
    page(<PayablePage />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Record a payment on From before this app",
      }),
    );
    const dialog = await dialogTitled("Pay a supplier");
    // Opened on the old debt, ticked: the amount adds up to it.
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect((amount as HTMLInputElement).value).toBe(
      (5 * JT).toLocaleString("de-DE"),
    );

    await userEvent.clear(amount);
    await userEvent.type(amount, String(10 * JT));
    expect(
      within(dialog).getByText(`3 invoice(s) selected · ${fmtRp(10 * JT)}`),
    ).toBeTruthy();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    await waitFor(() =>
      expect(
        getDb().suppliers.find((s) => s.id === SUP)?.openingPayments,
      ).toBeDefined(),
    );
    const db = getDb();
    expect(
      db.suppliers
        .find((s) => s.id === SUP)!
        .openingPayments!.map((p) => p.amount),
    ).toEqual([5 * JT]);
    const paid = (id: string) =>
      poTotals(db.pos.find((p) => p.id === id)!).paid;
    expect([
      paid("pi-a1"),
      paid("pi-a2"),
      paid("pi-a3"),
      paid("pi-a4"),
    ]).toEqual([2 * JT, 3 * JT, 0, 0]);
  });

  it("keeps money above every invoice as a deposit, out of the balance when switched off", async () => {
    page(<PayablePage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Record a payment on PI-A4" }),
    );
    const dialog = await dialogTitled("Pay a supplier");
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    await userEvent.clear(amount);
    // Everything still owed after the first test is 1 + 2 + 1 = 4jt.
    await userEvent.type(amount, String(5 * JT));
    expect(
      within(dialog).getByText((t) => t.includes("kept as a deposit")),
    ).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("switch", {
        name: "Counts in the shop's balance",
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );

    await waitFor(() =>
      expect(getDb().deposits.some((d) => d.supplierId === SUP)).toBe(true),
    );
    const db = getDb();
    const deposit = db.deposits.find((d) => d.supplierId === SUP)!;
    expect(deposit.amount).toBe(1 * JT);
    expect(deposit.inBalance).toBe(false);
    const a4 = db.pos.find((p) => p.id === "pi-a4")!;
    expect(poTotals(a4).outstanding).toBe(0);
    expect(a4.payments.every((p) => p.inBalance === false)).toBe(true);
  });
});

describe("Receive a customer's payment", () => {
  it("refuses more than the customer owes", async () => {
    const sale = getDb().orders.find(
      (o) => o.customerId !== null && customerDebtOf(o) > 0,
    );
    if (!sale) return; // the demo seed has at least one; nothing to pin without
    const owed = customerDebtOf(sale);
    page(<ReceivablePage />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Record a payment on ${sale.code}`,
      }),
    );
    const dialog = await dialogTitled("Receive a customer's payment");
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    await userEvent.clear(amount);
    const all = getDb()
      .orders.filter((o) => o.customerId === sale.customerId)
      .reduce((n, o) => n + customerDebtOf(o), 0);
    const opening =
      getDb().customers.find((c) => c.id === sale.customerId)?.openingBalance ??
      0;
    await userEvent.type(amount, String(all + opening + 1));
    expect(
      within(dialog).getByText((t) => t.includes("cannot be paid ahead")),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Record payment" }),
    ).toHaveProperty("disabled", true);

    // An empty box goes back to adding up the ticked row — the sale it was
    // opened on — and paying that clears the sale.
    await userEvent.clear(amount);
    expect((amount as HTMLInputElement).value).toBe(
      owed.toLocaleString("de-DE"),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    await waitFor(() =>
      expect(
        customerDebtOf(getDb().orders.find((o) => o.id === sale.id)!),
      ).toBe(0),
    );
    const after = getDb().orders.find((o) => o.id === sale.id)!;
    expect(after.payments?.at(-1)).toMatchObject({
      state: "SETTLED",
      amount: owed,
    });
    expect(getDb().paymentLog.some((l) => l.after?.amount === owed)).toBe(true);
  });
});
