/**
 * Edit transaction is the one page for a sale's money (owner, 2026-10-22):
 * a marketplace payment's deductions and its "payout received" are entered
 * under it, and a sale that is no longer a marketplace sale carries no
 * reference ID. Plus the month close that locks only what is settled.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

    const card = screen
      .getByText(/Shopee payout/)
      .closest(".ant-card") as HTMLElement;
    await userEvent.click(
      within(card).getByRole("button", { name: /Add deduction/ }),
    );
    await userEvent.type(
      within(card).getByRole("textbox", { name: "Deduction name" }),
      "Komisi",
    );
    const amount = within(card).getByRole("spinbutton", {
      name: "Deduction amount",
    });
    await userEvent.type(amount, "250000");
    fireEvent.blur(amount);
    await userEvent.click(
      within(card).getByRole("switch", { name: "Payout received" }),
    );
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

describe("closing a month locks only what is settled", () => {
  const closed = { booksClosedAt: "2026-10-31T16:59:59.999Z" };
  const sale = (over: Partial<Order>): Order =>
    ({
      id: "x",
      code: "SI-X",
      ts: "2026-10-10T03:00:00.000Z",
      customerId: null,
      serials: [],
      prices: {},
      discount: 0,
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: true,
      total: 1_000_000,
      ...over,
    }) as Order;

  it("locks a settled sale inside the month", () => {
    expect(
      isSaleLocked(
        sale({
          payments: [
            {
              id: "p",
              method: "TRANSFER",
              amount: 1_000_000,
              state: "SETTLED",
              at: "2026-10-10T03:00:00.000Z",
            },
          ],
        }),
        closed,
      ),
    ).toBe(true);
  });

  it("leaves one still waiting on a marketplace open", () => {
    expect(
      isSaleLocked(
        sale({
          settled: false,
          payments: [
            {
              id: "p",
              method: "MARKETPLACE",
              amount: 1_000_000,
              state: "PENDING",
              channel: "SHOPEE",
              at: "2026-10-10T03:00:00.000Z",
            },
          ],
        }),
        closed,
      ),
    ).toBe(false);
  });

  it("leaves a sale after the month open", () => {
    expect(isSaleLocked(sale({ ts: "2026-11-02T03:00:00.000Z" }), closed)).toBe(
      false,
    );
  });
});
