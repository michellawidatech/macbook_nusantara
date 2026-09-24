/**
 * Split payment, part payment, and what a customer actually owes.
 *
 * The owner's asks of 2026-09-08. See `lib/salePayments.ts` for why a sale
 * carries a LIST of receipts rather than a method and a flag.
 */
import { describe, expect, it } from "vitest";
import {
  customerBalance,
  isOverdue,
  isSettled,
  overpaid,
  paymentsOf,
  saleBalance,
  type SalePayment,
} from "../src/lib/salePayments.js";

const pay = (over: Partial<SalePayment>): SalePayment => ({
  id: "p1",
  method: "TUNAI",
  amount: 0,
  state: "SETTLED",
  at: "2026-09-08T03:00:00.000Z",
  ...over,
});

describe("saleBalance", () => {
  it("adds a split sale up in three separate buckets", () => {
    // The owner's own example: Rp5jt cash and Rp5jt Shopee PayLater. The cash
    // is the shop's today; the PayLater money is with Shopee.
    const b = saleBalance(10_000_000, [
      pay({ id: "a", amount: 5_000_000, state: "SETTLED" }),
      pay({
        id: "b",
        amount: 5_000_000,
        state: "PENDING",
        channel: "SHOPEE",
        method: "MARKETPLACE",
      }),
    ]);
    expect(b.settled).toBe(5_000_000);
    expect(b.pending).toBe(5_000_000);
    expect(b.due).toBe(0);
    expect(b.unaccounted).toBe(0);
    // Not settled: half the bill is somebody else's to release.
    expect(b.fullySettled).toBe(false);
    // And NOT a customer debt — they have paid their half to Shopee.
    expect(b.customerOwes).toBe(0);
  });

  it("keeps pending apart from a debt", () => {
    // The failure the old `settled` boolean caused: a Shopee sale awaiting
    // withdrawal looked exactly like a customer who had not paid.
    const marketplace = saleBalance(10_000_000, [
      pay({ amount: 10_000_000, state: "PENDING", channel: "TOKOPEDIA" }),
    ]);
    const debtor = saleBalance(10_000_000, [
      pay({ amount: 10_000_000, state: "DUE", dueAt: "2026-09-30" }),
    ]);
    expect(marketplace.customerOwes).toBe(0);
    expect(debtor.customerOwes).toBe(10_000_000);
  });

  it("counts an unpaid remainder even when nobody entered a line for it", () => {
    // A deposit of Rp2jt against a Rp10jt bill and nothing else recorded.
    // The other Rp8jt is owed whether or not somebody typed a DUE row.
    const b = saleBalance(10_000_000, [pay({ amount: 2_000_000 })]);
    expect(b.unaccounted).toBe(8_000_000);
    expect(b.customerOwes).toBe(8_000_000);
    expect(b.fullySettled).toBe(false);
  });

  it("never reports a negative gap", () => {
    const b = saleBalance(5_000_000, [pay({ amount: 8_000_000 })]);
    expect(b.unaccounted).toBe(0);
    // Over-recorded money shows here instead, where it can be looked at.
    expect(overpaid(b)).toBe(3_000_000);
  });

  it("reports the earliest promise, not the latest", () => {
    const b = saleBalance(10_000_000, [
      pay({ id: "a", amount: 5_000_000, state: "DUE", dueAt: "2026-10-15" }),
      pay({ id: "b", amount: 5_000_000, state: "DUE", dueAt: "2026-09-20" }),
    ]);
    expect(b.nextDueAt).toBe("2026-09-20");
  });

  it("calls a fully collected sale settled", () => {
    expect(isSettled(10_000_000, [pay({ amount: 10_000_000 })])).toBe(true);
    expect(
      isSettled(10_000_000, [
        pay({ amount: 5_000_000 }),
        pay({ id: "b", amount: 5_000_000, state: "PENDING" }),
      ]),
    ).toBe(false);
  });
});

describe("paymentsOf", () => {
  const legacy = {
    id: "o-1",
    total: 10_000_000,
    payMethod: "TUNAI",
    settled: true,
    source: "OFFLINE",
    ts: "2026-09-01T03:00:00.000Z",
  };

  it("reads an order written before the list existed", () => {
    // Not a migration — the honest reading of what `payMethod` and `settled`
    // actually said.
    const [p] = paymentsOf(legacy);
    expect(p).toMatchObject({
      amount: 10_000_000,
      method: "TUNAI",
      state: "SETTLED",
    });
  });

  it("reads an unsettled legacy sale as pending on its channel", () => {
    const [p] = paymentsOf({
      ...legacy,
      settled: false,
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
    });
    expect(p).toMatchObject({ state: "PENDING", channel: "SHOPEE" });
  });

  it("prefers the list when there is one", () => {
    const payments = [pay({ amount: 1 })];
    expect(paymentsOf({ ...legacy, payments })).toBe(payments);
  });

  it("invents nothing for a sale a return emptied (2026-09-21)", () => {
    // Everything cancelled, or moved to the sale an exchange went out on:
    // no payments is the truth, not a sale from before the list existed —
    // reading it as one would put the whole ORIGINAL total in the balance.
    const returned = {
      ...legacy,
      adjustments: [
        {
          id: "adj-1",
          type: "RETUR" as const,
          code: "SG-2026/09-000001",
          amount: 10_000_000,
          reason: "Returned",
          at: "2026-09-21T03:00:00.000Z",
        },
      ],
    };
    expect(paymentsOf({ ...returned, payments: [] })).toEqual([]);
    // …and Postgres, which projects no payment rows as no list at all.
    expect(paymentsOf(returned)).toEqual([]);
  });
});

describe("customerBalance", () => {
  const order = (
    id: string,
    total: number,
    payments: SalePayment[],
    customerId = "c-1",
  ) => ({
    id,
    customerId,
    total,
    payMethod: "TUNAI",
    settled: false,
    source: "OFFLINE",
    ts: "2026-09-01T03:00:00.000Z",
    payments,
  });

  it("rolls a customer's sales into one balance", () => {
    const orders = [
      order("o1", 10_000_000, [
        pay({ amount: 4_000_000 }),
        pay({ id: "b", amount: 6_000_000, state: "DUE", dueAt: "2026-09-30" }),
      ]),
      order("o2", 5_000_000, [
        pay({
          id: "c",
          amount: 5_000_000,
          state: "PENDING",
          channel: "SHOPEE",
        }),
      ]),
      // Somebody else's sale, which must not land on this customer.
      order(
        "o3",
        9_000_000,
        [pay({ id: "d", amount: 0, state: "DUE" })],
        "c-2",
      ),
    ];
    const b = customerBalance("c-1", orders);
    expect(b.billed).toBe(15_000_000);
    expect(b.settled).toBe(4_000_000);
    expect(b.pending).toBe(5_000_000);
    // The debt is the DUE part only — the Shopee money is not theirs to chase.
    expect(b.owed).toBe(6_000_000);
    expect(b.openSales).toBe(1);
    expect(b.nextDueAt).toBe("2026-09-30");
  });

  it("answers zero for a customer with no sales", () => {
    expect(customerBalance("nobody", []).owed).toBe(0);
  });

  it("owes a debt from before this app, without opening a sale for it", () => {
    const orders = [order("o1", 1_000_000, [pay({ amount: 1_000_000 })])];
    const b = customerBalance("c-1", orders, 2_500_000);
    expect(b.owed).toBe(2_500_000);
    expect(b.openingBalance).toBe(2_500_000);
    expect(b.billed).toBe(1_000_000);
    expect(b.openSales).toBe(0);
    expect(b.nextDueAt).toBeUndefined();
  });
});

describe("isOverdue", () => {
  const now = Date.parse("2026-09-08T03:00:00.000Z");

  it("is true only for a promise whose date has passed", () => {
    expect(isOverdue(pay({ state: "DUE", dueAt: "2026-09-01" }), now)).toBe(
      true,
    );
    expect(isOverdue(pay({ state: "DUE", dueAt: "2026-10-01" }), now)).toBe(
      false,
    );
  });

  it("is never true of money a marketplace is holding", () => {
    // A platform sitting on a payout is not a customer failing to pay.
    expect(isOverdue(pay({ state: "PENDING", dueAt: "2026-01-01" }), now)).toBe(
      false,
    );
  });

  it("is never true of a promise with no date", () => {
    expect(isOverdue(pay({ state: "DUE" }), now)).toBe(false);
  });
});
