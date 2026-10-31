/**
 * Edit transaction on a sale whose trade-in is recorded gross (owner answers
 * 2026-10-31): the value can change, a trade-in can be added or removed, the
 * unit's cost follows, and what the shop paid the customer back is corrected
 * here too. The trade-in's payment always equals the trade-in less the money
 * handed back (`lib/tradeIn.ts`).
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditTransactionModal } from "../src/routes/finance/EditTransactionModal.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

const TRADED = "C6YMTRADE01";

/** A sold seed sale, re-dressed as a gross trade-in sale of the owner's case. */
function grossSale(id: string, tradeValue: number, payout: number): Order {
  const base = getDb().orders.find(
    (o) => o.serials.length === 1 && !o.adjustments && !o.tradeIns && !o.lines,
  )!;
  const bill = base.prices[base.serials[0]!]!;
  const paidByTrade = Math.min(tradeValue, bill);
  mutate((d) => {
    d.units.push({
      serial: TRADED,
      skuId: d.skus[0]!.id,
      status: "TERSEDIA",
      locationId: d.myWarehouseId,
      buy: tradeValue,
      description: "Fullset",
      grade: "A",
      poId: null,
    });
    d.orders.push({
      ...structuredClone(base),
      id,
      code: `SI-${id}`,
      total: bill,
      discount: 0,
      fees: undefined,
      extra: undefined,
      tradeInGross: true,
      tradeIns: [
        { id: `${id}-t`, label: "Pro 14", serial: TRADED, value: tradeValue },
      ],
      payments: [
        {
          id: `${id}-tt`,
          method: "TUKAR_TAMBAH",
          amount: paidByTrade,
          state: "SETTLED",
          at: base.ts,
          inBalance: false,
        },
        ...(bill > paidByTrade
          ? [
              {
                id: `${id}-cash`,
                method: "TUNAI",
                amount: bill - paidByTrade,
                state: "SETTLED" as const,
                at: base.ts,
              },
            ]
          : []),
      ],
      settled: true,
    } as Order);
    if (payout > 0)
      d.expenses.push({
        id: `${id}-payout`,
        kind: "TUKAR_TAMBAH",
        amount: payout,
        date: base.ts.slice(0, 10),
        method: "TRANSFER",
        orderId: id,
        createdAt: base.ts,
      });
  });
  return getDb().orders.find((o) => o.id === id)!;
}

const renderEdit = (order: Order) =>
  render(
    <AntdApp>
      <EditTransactionModal open order={order} onClose={() => {}} />
    </AntdApp>,
  );

const save = () =>
  userEvent.click(screen.getByRole("button", { name: /^(Save|OK)/ }));

describe("a gross trade-in in Edit transaction", () => {
  it("moves the trade-in's payment and the unit's cost with a new value", async () => {
    const sale = grossSale("o-ti-edit", 2_000_000, 0);
    renderEdit(sale);
    const value = screen.getByRole("spinbutton", { name: "Trade-in value" });
    await userEvent.clear(value);
    await userEvent.type(value, "3000000");
    fireEvent.blur(value);
    expect(
      screen.getByText(/The trade-in pays Rp 3\.000\.000 of the bill/),
    ).toBeInTheDocument();
    await save();

    const o = getDb().orders.find((x) => x.id === sale.id)!;
    expect(o.tradeIns![0]!.value).toBe(3_000_000);
    expect(o.payments!.find((p) => p.method === "TUKAR_TAMBAH")!.amount).toBe(
      3_000_000,
    );
    expect(o.total).toBe(sale.total);
    expect(getDb().units.find((u) => u.serial === TRADED)!.buy).toBe(3_000_000);
  });

  it("corrects what the shop paid the customer, and keeps the invariant", async () => {
    // Trade-in worth 2jt more than the bill; the shop paid 2jt back.
    const base = getDb().orders.find(
      (o) =>
        o.serials.length === 1 && !o.adjustments && !o.tradeIns && !o.lines,
    )!;
    const bill = base.prices[base.serials[0]!]!;
    const sale = grossSale("o-ti-payout", bill + 2_000_000, 2_000_000);
    renderEdit(sale);
    const amount = screen.getByRole("spinbutton", { name: "Amount paid" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "1500000");
    fireEvent.blur(amount);
    // 500rb less handed back is 500rb more of the bill paid by the trade-in.
    await save();

    const db = getDb();
    const o = db.orders.find((x) => x.id === sale.id)!;
    expect(db.expenses.find((e) => e.id === "o-ti-payout-payout")!.amount).toBe(
      1_500_000,
    );
    expect(o.payments!.find((p) => p.method === "TUKAR_TAMBAH")!.amount).toBe(
      bill + 500_000,
    );
  });

  it("will not remove a trade-in whose unit has been sold on", async () => {
    const sale = grossSale("o-ti-moved", 2_000_000, 0);
    mutate((d) => {
      d.units.find((u) => u.serial === TRADED)!.status = "TERJUAL";
    });
    renderEdit(sale);
    expect(
      screen.getByRole("button", { name: "Remove trade-in Pro 14" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("spinbutton", { name: "Trade-in value" }),
    ).toBeDisabled();
  });
});
