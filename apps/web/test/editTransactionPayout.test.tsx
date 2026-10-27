/**
 * Edit transaction is the one page for a sale's money (owner, 2026-10-22):
 * a marketplace payment's deductions and its "payout received" are entered
 * under it, and a sale that is no longer a marketplace sale carries no
 * reference ID. Plus the month close that locks only what is settled.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditTransactionModal } from "../src/routes/finance/EditTransactionModal.js";
import { getDb, mutate } from "../src/mock/store.js";
import { isSaleLocked } from "../src/lib/bookClose.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

function addSale(id: string, over: Partial<Order>): Order {
  const base = getDb().orders.find(
    (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
  )!;
  const total = base.total;
  mutate((d) => {
    d.orders.push({
      ...structuredClone(base),
      id,
      code: `SI-${id}`,
      total,
      ...over,
    } as Order);
  });
  return getDb().orders.find((o) => o.id === id)!;
}

const renderEdit = (order: Order) =>
  render(
    <AntdApp>
      <EditTransactionModal open order={order} onClose={() => {}} />
    </AntdApp>,
  );

describe("a Shopee payment's payout, in the Edit transaction dialog", () => {
  it("takes deductions and the payout received, in one save", async () => {
    const draft = getDb().orders.find(
      (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
    )!;
    const sale = addSale("o-payout", {
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: false,
      payments: [
        {
          id: "pay-o-payout",
          method: "MARKETPLACE",
          amount: draft.total,
          state: "PENDING",
          channel: "SHOPEE",
          at: "2026-10-20T03:00:00.000Z",
          ref: "2610SHP001",
        },
      ],
    });
    renderEdit(sale);

    // The "−" at the end of the Shopee row opens a deduction nested under it.
    await userEvent.click(
      screen.getByRole("button", { name: "Add a deduction" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Deduction name" }),
      "Komisi",
    );
    const amount = screen.getByRole("spinbutton", { name: "Deduction amount" });
    await userEvent.type(amount, "250000");
    fireEvent.blur(amount);
    // The row's own status is the payout: Settled = it landed.
    fireEvent.mouseDown(
      screen.getAllByRole("combobox", { name: "State of this payment" })[0]!,
    );
    const settled = await vi.waitFor(() => {
      const el = Array.from(
        document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
      ).find((o) => o.getAttribute("title") === "Settled");
      if (!el) throw new Error("no Settled option");
      return el;
    });
    fireEvent.click(settled);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const after = getDb().orders.find((o) => o.id === "o-payout")!;
    const pay = after.payments!.find((p) => p.id === "pay-o-payout")!;
    expect(pay.state).toBe("SETTLED");
    expect(pay.ref).toBe("2610SHP001");
    const s = getDb().settlements.find((x) => x.paymentId === "pay-o-payout")!;
    expect(s).toBeDefined();
    expect(s.fees.map((f) => [f.label, f.amount])).toEqual([
      ["Komisi", 250_000],
    ]);
    expect(s.received).toBe(draft.total - 250_000);
    expect(after.netReceived).toBe(after.total - 250_000);
  });
});

describe("the reference ID follows the channel", () => {
  it("is not asked for, and not kept, on a sale that is no longer a marketplace's", async () => {
    const draft = getDb().orders.find(
      (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
    )!;
    const sale = addSale("o-noref", {
      source: "INSTAGRAM",
      payMethod: "TRANSFER",
      settled: true,
      payments: [
        {
          id: "pay-o-noref",
          method: "TRANSFER",
          amount: draft.total,
          state: "SETTLED",
          at: "2026-10-20T03:00:00.000Z",
          ref: "2610SHP999",
        },
      ],
    });
    renderEdit(sale);
    expect(screen.queryByText("Reference ID")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const after = getDb().orders.find((o) => o.id === "o-noref")!;
    expect(after.payments!.every((p) => p.ref === undefined)).toBe(true);
  });

  it("is asked for on TikTok taken in cash", () => {
    const draft = getDb().orders.find(
      (o) => o.serials.length > 0 && !o.adjustments && !o.tradeIns,
    )!;
    const sale = addSale("o-tiktok", {
      source: "TIKTOK",
      payMethod: "TUNAI",
      settled: true,
      payments: [
        {
          id: "pay-o-tiktok",
          method: "TUNAI",
          amount: draft.total,
          state: "SETTLED",
          at: "2026-10-20T03:00:00.000Z",
        },
      ],
    });
    renderEdit(sale);
    expect(screen.getByText("Reference ID")).toBeTruthy();
  });
});

describe("the retired book close (2026-10-27)", () => {
  // A month a shop closed before the retirement stays stored, and is ignored:
  // reconciliation flags an edited period instead of locking it.
  const closed = { booksClosedAt: "2026-10-31T16:59:59.999Z" };

  it("locks no sale, even a settled one inside the old closed month", () => {
    const sale = {
      id: "x",
      code: "SI-X",
      ts: "2026-10-10T03:00:00.000Z",
      customerId: null,
      serials: [],
      prices: {},
      discount: 0,
      source: "SHOPEE",
      payMethod: "TRANSFER",
      settled: true,
      total: 1_000_000,
      payments: [
        {
          id: "p",
          method: "TRANSFER",
          amount: 1_000_000,
          state: "SETTLED",
          at: "2026-10-10T03:00:00.000Z",
        },
      ],
    } as Order;
    expect(isSaleLocked(sale, closed)).toBe(false);
  });
});
