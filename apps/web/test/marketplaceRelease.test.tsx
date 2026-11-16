/**
 * Owner asks of 2026-11-13 on the sale screens:
 *
 * - *"For the Shopee transaction, the status is no longer 'Held by
 *   marketplace' or 'Received', but only save the total amount and the
 *   deduction."* — Edit transaction offers no Status for a marketplace
 *   payment; a deduction is written on Save and the Shopee balance follows.
 * - *"When exporting the transaction history, it should follow the filter in
 *   the page; now it still downloads all transactions."*
 */
import { pressPageAction } from "./pageActions.js";
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EditTransactionModal } from "../src/routes/finance/EditTransactionModal.js";
import { TransactionsPage } from "../src/routes/finance/TransactionsPage.js";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

function addSale(id: string, over: Partial<Order>): Order {
  const base = getDb().orders.find(
    (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
  )!;
  mutate((d) => {
    d.orders.push({
      ...structuredClone(base),
      id,
      code: `SI-${id}`,
      ...over,
    } as Order);
  });
  return getDb().orders.find((o) => o.id === id)!;
}

describe("a Shopee payment in Edit transaction", () => {
  it("asks for no status, and its deduction is written only by Save", async () => {
    const base = getDb().orders.find(
      (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
    )!;
    const sale = addSale("o-release", {
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: false,
      payments: [
        {
          id: "pay-o-release",
          method: "MARKETPLACE",
          amount: base.total,
          state: "PENDING",
          channel: "SHOPEE",
          at: "2026-10-20T03:00:00.000Z",
          ref: "2611SHP001",
        },
      ],
    });
    // The Shopee upload recorded its payout (2026-11-15: the only way one
    // starts); Edit transaction corrects it.
    mutate((d) => {
      d.settlements.push({
        id: "stl-release",
        paymentId: "pay-o-release",
        orderId: "o-release",
        channel: "SHOPEE",
        gross: base.total,
        fees: [
          {
            id: "f-adm",
            kind: "COMMISSION",
            label: "Biaya Administrasi",
            amount: 100_000,
          },
        ],
        received: base.total - 100_000,
        at: "2026-10-21T03:00:00.000Z",
        staff: "test",
      });
    });
    render(
      <AntdApp>
        <EditTransactionModal open order={sale} onClose={() => {}} />
      </AntdApp>,
    );
    expect(
      screen.queryAllByRole("combobox", { name: "State of this payment" }),
    ).toHaveLength(0);

    await userEvent.click(
      screen.getByRole("button", { name: "Add a deduction" }),
    );
    // Nothing is written yet.
    const stored = () =>
      getDb()
        .orders.find((o) => o.id === "o-release")!
        .payments!.find((p) => p.id === "pay-o-release")!;
    expect(stored().state).toBe("PENDING");
    expect(
      getDb().settlements.find((s) => s.paymentId === "pay-o-release")!.fees,
    ).toHaveLength(1);

    const names = screen.getAllByRole("textbox", { name: "Deduction name" });
    await userEvent.type(names.at(-1)!, "Komisi");
    const amount = screen
      .getAllByRole("spinbutton", { name: "Deduction amount" })
      .at(-1)!;
    await userEvent.type(amount, "300000");
    fireEvent.blur(amount);
    expect(screen.getByText(/= Rp .* to the Shopee balance$/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The deduction is all that is written; the payment keeps its day.
    expect(stored().state).toBe("PENDING");
    expect(stored().at).toBe("2026-10-20T03:00:00.000Z");
    const s = getDb().settlements.find((x) => x.paymentId === "pay-o-release")!;
    expect(s.received).toBe(base.total - 400_000);
  });
});

describe("Transaction History's export", () => {
  it("writes what the list shows, not every sale", async () => {
    const created: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (b: Blob) => {
        created.push(b);
        return "blob:csv";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const code = getDb().orders[0]!.code;
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/finance/transactions"]}>
          <TransactionsPage />
        </MemoryRouter>
      </AntdApp>,
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Search an order, reference, serial, product or customer",
      ),
      { target: { value: code } },
    );
    // A row behind More on a phone (2026-11-16), named for what it writes.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    pressPageAction(/Export 1 shown/);
    click.mockRestore();

    expect(created).toHaveLength(1);
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    const lines = csv.split("\r\n").filter((l) => l !== "");
    // The heading and the one sale the search left.
    expect(lines).toHaveLength(2);
    expect(lines[1]!.startsWith(`"${code}"`)).toBe(true);
  });
});

describe("the seller balance on Income & Expense", () => {
  it("is a card per channel, and a withdrawal moves money from it to the bank", async () => {
    const base = getDb().orders.find(
      (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
    )!;
    const now = new Date().toISOString();
    addSale("o-pot", {
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: true,
      ts: now,
      payments: [
        {
          id: "pay-o-pot",
          method: "MARKETPLACE",
          amount: base.total,
          // As the till writes one: no status is read.
          state: "PENDING",
          channel: "SHOPEE",
          at: now,
        },
      ],
    });
    // In the balance once the Shopee upload records its payout (2026-11-15).
    mutate((d) => {
      d.settlements = d.settlements.filter((x) => x.paymentId !== "pay-o-pot");
      d.settlements.push({
        id: "stl-o-pot",
        paymentId: "pay-o-pot",
        orderId: "o-pot",
        channel: "SHOPEE",
        gross: base.total,
        fees: [
          {
            id: "f-pot",
            kind: "COMMISSION",
            label: "Biaya Administrasi",
            amount: 100_000,
          },
        ],
        received: base.total - 100_000,
        at: now,
        staff: "test",
      });
    });
    const rupiah = (el: HTMLElement) =>
      Number((el.textContent ?? "").replace(/[^\d-]/g, ""));
    render(
      <AntdApp>
        <MemoryRouter>
          <IncomeExpensePage />
        </MemoryRouter>
      </AntdApp>,
    );
    const card = screen.getByTestId("seller-pot-SHOPEE");
    await userEvent.click(
      screen.getByRole("button", { name: "Show Shopee balance" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Show Bank" }));
    const potBefore = rupiah(screen.getByTestId("pot-market-SHOPEE"));
    const bankBefore = rupiah(screen.getByTestId("pot-bank"));
    expect(potBefore).toBeGreaterThanOrEqual(base.total - 100_000);

    await userEvent.click(
      within(card).getByRole("button", { name: "Record withdrawal" }),
    );
    const dialog = (await screen.findByText("Record it")).closest(
      ".ant-modal",
    ) as HTMLElement;
    expect(within(dialog).getByText("Shopee withdrawal")).toBeTruthy();
    expect(within(dialog).getByTestId("seller-balance-hint")).toBeTruthy();
    const amount = within(dialog).getByRole("spinbutton");
    await userEvent.type(amount, "1000000");
    fireEvent.blur(amount);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record it" }),
    );

    await vi.waitFor(() =>
      expect(rupiah(screen.getByTestId("pot-market-SHOPEE"))).toBe(
        potBefore - 1_000_000,
      ),
    );
    expect(rupiah(screen.getByTestId("pot-bank"))).toBe(bankBefore + 1_000_000);
    expect(
      getDb().incomes.some(
        (i) =>
          i.reason === "PENARIKAN_SHOPEE" &&
          i.method === "TRANSFER" &&
          i.amount === 1_000_000,
      ),
    ).toBe(true);
  });
});
