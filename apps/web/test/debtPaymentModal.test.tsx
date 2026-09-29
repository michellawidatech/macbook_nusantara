/**
 * Add payment on Payable and Receivable, driven the way the desk drives it
 * (owner ask 2026-09-22). The arithmetic is `test/allocatePayment.test.ts`;
 * what this pins is that the dialog writes what it shows — the owner's
 * example, spread oldest first, end to end.
 *
 * The rows are grouped per party since 2026-09-24, so the button these tests
 * press is the SUPPLIER's: it ticks every invoice under it, which is the
 * *"autofill the transaction detail accordingly"* half of that ask. A
 * document's own button is behind the expand chevron.
 */
import type { ReactNode } from "react";
import { App as AntdApp } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PayablePage,
  ReceivablePage,
} from "../src/routes/finance/PayableReceivablePage.js";
import { customerDebtOf } from "../src/lib/payableReceivable.js";
import { customerLabel } from "../src/lib/customers.js";
import { openingOwed } from "../src/lib/debtPayments.js";
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
  // One supplier owing the owner's example: invoices of 2, 4, 2 and 1jt.
  // `Supplier.openingBalance` went on 2026-09-24, so the 5jt of old debt the
  // example opened with is four invoices now and nothing before them.
  if (getDb().suppliers.some((s) => s.id === SUP)) return;
  await mutate((d) => {
    d.suppliers.push({
      id: SUP,
      name: "Toko Uji Alokasi",
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
  it("opens on the whole supplier and spreads 5jt oldest first", async () => {
    page(<PayablePage />);
    // The SUPPLIER's button (2026-09-24): every invoice under it is ticked, so
    // the amount box opens at what that supplier is owed in total.
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Record a payment to Toko Uji Alokasi",
      }),
    );
    const dialog = await dialogTitled("Pay a supplier");
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect((amount as HTMLInputElement).value).toBe(
      (9 * JT).toLocaleString("de-DE"),
    );

    await userEvent.clear(amount);
    await userEvent.type(amount, String(5 * JT));
    expect(
      within(dialog).getByText(`2 invoice(s) selected · ${fmtRp(5 * JT)}`),
    ).toBeTruthy();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    const paid = (id: string) =>
      poTotals(getDb().pos.find((p) => p.id === id)!).paid;
    await waitFor(() => expect(paid("pi-a1")).toBe(2 * JT));
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
      await screen.findByRole("button", {
        name: "Record a payment to Toko Uji Alokasi",
      }),
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
    const who = getDb().customers.find((c) => c.id === sale.customerId)!;
    const label = customerLabel(who);
    const all = getDb()
      .orders.filter((o) => o.customerId === sale.customerId)
      .reduce((n, o) => n + customerDebtOf(o), 0);
    const opening = openingOwed(who);
    const whole = all + opening;

    page(<ReceivablePage />);
    // The CUSTOMER's button (2026-09-24), which ticks every sale of theirs.
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Record a payment to ${label}`,
      }),
    );
    const dialog = await dialogTitled("Receive a customer's payment");
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect((amount as HTMLInputElement).value).toBe(
      whole.toLocaleString("de-DE"),
    );

    await userEvent.clear(amount);
    await userEvent.type(amount, String(whole + 1));
    expect(
      within(dialog).getByText((t) => t.includes("cannot be paid ahead")),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Record payment" }),
    ).toHaveProperty("disabled", true);

    // An empty box goes back to adding up what is ticked, and paying it
    // clears every sale of theirs.
    await userEvent.clear(amount);
    expect((amount as HTMLInputElement).value).toBe(
      whole.toLocaleString("de-DE"),
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
    expect(after.payments?.at(-1)).toMatchObject({ state: "SETTLED" });
    expect(getDb().paymentLog.length).toBeGreaterThan(0);
  });
});

describe("starting from the transaction (owner ask 2026-09-24)", () => {
  const SALE = { id: "o-finder-1", code: "SI-2026/09-FIND01" };
  const AT = "2026-09-20T03:00:00.000Z";

  beforeEach(async () => {
    if (getDb().orders.some((o) => o.id === SALE.id)) return;
    // A named customer's sale, part paid: 3jt in the drawer, 7jt promised.
    const customer = getDb().customers[0]!;
    await mutate((d) => {
      d.orders.push({
        id: SALE.id,
        code: SALE.code,
        ts: AT,
        customerId: customer.id,
        serials: [],
        prices: {},
        discount: 0,
        source: "OFFLINE",
        payMethod: "TUNAI",
        settled: false,
        payments: [
          {
            id: "pay-finder-1",
            method: "TUNAI",
            amount: 3 * JT,
            state: "SETTLED",
            at: AT,
          },
          {
            id: "pay-finder-2",
            method: "TUNAI",
            amount: 7 * JT,
            state: "DUE",
            at: AT,
          },
        ],
        total: 10 * JT,
      });
    });
  });

  it("finds the sale by its number, fills the customer in and ticks it", async () => {
    page(<ReceivablePage />);
    // An icon button's name carries the icon's ("plus Add payment").
    await userEvent.click(
      await screen.findByRole("button", { name: /Add payment/ }),
    );
    const dialog = await dialogTitled("Receive a customer's payment");
    // Nobody chosen yet: the amount waits for a party.
    expect(
      within(dialog).getByRole("spinbutton", { name: "Amount" }),
    ).toBeDisabled();

    // The receipt in hand, not the name: type the number into the finder.
    const finder = within(dialog).getByRole("combobox", {
      name: "Transaction ID",
    });
    fireEvent.mouseDown(finder);
    fireEvent.change(finder, { target: { value: "find01" } });
    const option = await waitFor(() => {
      const open = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
        ),
      );
      const found = Array.from(
        open[open.length - 1]?.querySelectorAll<HTMLElement>(
          ".ant-select-item-option",
        ) ?? [],
      ).find((el) => el.textContent?.startsWith(SALE.code));
      if (!found) throw new Error(`no option for ${SALE.code} open`);
      return found;
    });
    fireEvent.click(option);

    // The customer filled in from the sale, and the sale ticked: the amount
    // adds up to what it owes.
    const customer = getDb().customers[0]!;
    expect(
      within(dialog).getAllByText(`${customer.name} · ${customer.phone}`),
    ).not.toHaveLength(0);
    expect(
      within(dialog).getByRole("checkbox", { name: `Pay ${SALE.code}` }),
    ).toBeChecked();
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect((amount as HTMLInputElement).value).toBe(
      (7 * JT).toLocaleString("de-DE"),
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record payment" }),
    );
    await waitFor(() =>
      expect(
        customerDebtOf(getDb().orders.find((o) => o.id === SALE.id)!),
      ).toBe(0),
    );
  });
});
