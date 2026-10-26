/**
 * What became of a sale: its payment status and whether any of it came back
 * (owner ask 2026-09-19, Transaction History).
 *
 * The payment half is the bug the old screen had — any shortfall read "Owed",
 * so "Part paid" could never appear for a positive total. The return half is
 * the server's `OrderItem.returnedAt` rule, read off the browser's ledger.
 * `lib/saleStatus.ts` explains both.
 */
import { describe, expect, it } from "vitest";
import { applyReturnCredit } from "../src/lib/returns.js";
import {
  billAfterReturns,
  orderBalance,
  paymentsOf,
  refundedOf,
  saleBalance,
  type OrderAdjustmentRec,
  type SalePayment,
  type SaleRefund,
} from "../src/lib/salePayments.js";
import {
  exchangedSales,
  paymentRefOf,
  returnedDebt,
  returnedSerials,
  salePaymentStatus,
  saleReturnStatus,
} from "../src/lib/saleStatus.js";

const pay = (over: Partial<SalePayment>): SalePayment => ({
  id: "p1",
  method: "TUNAI",
  amount: 0,
  state: "SETTLED",
  at: "2026-09-08T03:00:00.000Z",
  ...over,
});

const statusOf = (total: number, payments: SalePayment[]) =>
  salePaymentStatus(saleBalance(total, payments));

describe("salePaymentStatus", () => {
  it("is Settled when every rupiah is the shop's", () => {
    expect(statusOf(5_000_000, [pay({ amount: 5_000_000 })])).toBe("SETTLED");
  });

  it("is With a marketplace when the customer has paid and Shopee holds some", () => {
    // The owner's split example: Rp5jt cash, the rest on Shopee PayLater.
    expect(
      statusOf(10_000_000, [
        pay({ id: "a", amount: 5_000_000 }),
        pay({
          id: "b",
          amount: 5_000_000,
          state: "PENDING",
          channel: "SHOPEE",
          method: "MARKETPLACE",
        }),
      ]),
    ).toBe("WITH_MARKETPLACE");
  });

  it("is Partly paid when a deposit is in and the rest is promised", () => {
    // The fixture's DP sale. The old screen called this "Owed", exactly as it
    // called a sale nobody had paid a rupiah of.
    expect(
      statusOf(1_480_000, [
        pay({ id: "a", amount: 500_000, method: "TRANSFER" }),
        pay({
          id: "b",
          amount: 980_000,
          state: "DUE",
          dueAt: "2026-09-27T05:00:00.000Z",
        }),
      ]),
    ).toBe("PARTLY_PAID");
  });

  it("is Partly paid when a bill was recorded short, with nothing promised", () => {
    // The gap nobody accounted for is still money somebody has to collect.
    expect(statusOf(4_000_000, [pay({ amount: 3_000_000 })])).toBe(
      "PARTLY_PAID",
    );
  });

  it("counts marketplace money as paid when the rest is owed", () => {
    expect(
      statusOf(10_000_000, [
        pay({
          id: "a",
          amount: 4_000_000,
          state: "PENDING",
          channel: "TIKTOK",
        }),
        pay({ id: "b", amount: 6_000_000, state: "DUE" }),
      ]),
    ).toBe("PARTLY_PAID");
  });

  it("is Owed when the customer has paid nothing at all", () => {
    expect(
      statusOf(2_000_000, [pay({ amount: 2_000_000, state: "DUE" })]),
    ).toBe("OWED");
    expect(statusOf(2_000_000, [])).toBe("OWED");
  });

  it("reads a zero bill as Settled — there is nothing to collect", () => {
    expect(statusOf(0, [])).toBe("SETTLED");
  });
});

describe("returnedSerials", () => {
  const sale = (id: string, ts: string, serials: string[]) => ({
    id,
    ts,
    serials,
  });
  const back = (serial: string, at: string) => ({
    serial,
    type: "RETUR_PELANGGAN",
    at,
  });

  it("marks the serial a return brought back on the sale before it", () => {
    const out = returnedSerials(
      [sale("o-1", "2026-09-01T03:00:00.000Z", ["SA", "SB"])],
      [back("SA", "2026-09-04T03:00:00.000Z")],
    );
    expect([...(out.get("o-1") ?? [])]).toEqual(["SA"]);
  });

  it("never marks the resale that came after the return", () => {
    // Sold, brought back, sold again — the server's `order.ts <= at` rule.
    const orders = [
      sale("o-1", "2026-09-01T03:00:00.000Z", ["SA"]),
      sale("o-2", "2026-09-06T03:00:00.000Z", ["SA"]),
    ];
    const once = returnedSerials(orders, [
      back("SA", "2026-09-04T03:00:00.000Z"),
    ]);
    expect(once.get("o-1")?.has("SA")).toBe(true);
    expect(once.has("o-2")).toBe(false);

    // …until it comes back a second time.
    const twice = returnedSerials(orders, [
      back("SA", "2026-09-04T03:00:00.000Z"),
      back("SA", "2026-09-09T03:00:00.000Z"),
    ]);
    expect(twice.get("o-2")?.has("SA")).toBe(true);
  });

  it("ignores every other kind of event", () => {
    const out = returnedSerials(
      [sale("o-1", "2026-09-01T03:00:00.000Z", ["SA"])],
      [
        {
          serial: "SA",
          type: "RETUR_SUPPLIER",
          at: "2026-09-04T03:00:00.000Z",
        },
        { serial: "SA", type: "DIPINDAH", at: "2026-09-05T03:00:00.000Z" },
      ],
    );
    expect(out.size).toBe(0);
  });
});

describe("saleReturnStatus", () => {
  it("says Completed, Partly returned or Returned from what came back", () => {
    expect(saleReturnStatus(["SA", "SB"], undefined)).toBe("COMPLETED");
    expect(saleReturnStatus(["SA", "SB"], new Set(["SA"]))).toBe(
      "PARTLY_RETURNED",
    );
    expect(saleReturnStatus(["SA", "SB"], new Set(["SA", "SB"]))).toBe(
      "RETURNED",
    );
    // A set naming nothing on this sale changes nothing.
    expect(saleReturnStatus(["SA"], new Set(["SZ"]))).toBe("COMPLETED");
  });
});

describe("paymentRefOf", () => {
  it("names every distinct reference the payments carry", () => {
    // A Shopee part and a Tokopedia part are two orders with two numbers
    // (owner revision 2026-09-21); the same number twice is one.
    expect(
      paymentRefOf([
        pay({ id: "a", amount: 1 }),
        pay({ id: "b", amount: 1, ref: "  " }),
        pay({ id: "c", amount: 1, ref: " 240919ABCDEF " }),
        pay({ id: "d", amount: 1, ref: "TKP-SECOND" }),
        pay({ id: "e", amount: 1, ref: "240919ABCDEF" }),
      ]),
    ).toBe("240919ABCDEF, TKP-SECOND");
    expect(paymentRefOf([pay({ amount: 1 })])).toBeUndefined();
  });
});

/*
 * An unpaid sale, returned (owner ask 2026-10-26): *"the transaction history
 * is marked as Unpaid, returned"*. The return cancels the customer's debt, so
 * the balance owes nothing and used to read Settled — as if the money had
 * come in. `returnedDebt` reads the cancelled debt back off what is stored.
 */
describe("returnedDebt and the two returned statuses", () => {
  interface Sale {
    readonly id: string;
    readonly code: string;
    readonly ts: string;
    readonly total: number;
    readonly payMethod: string;
    readonly settled: boolean;
    readonly source: string;
    readonly payments?: readonly SalePayment[];
    readonly refunds?: readonly SaleRefund[];
    readonly adjustments?: readonly OrderAdjustmentRec[];
  }
  const sale = (
    total: number,
    payments: SalePayment[],
    over: Partial<Sale> = {},
  ): Sale => ({
    id: "o-1",
    code: "SI-2026/10-000001",
    ts: "2026-10-01T03:00:00.000Z",
    total,
    payMethod: "TUNAI",
    settled: false,
    source: "OFFLINE",
    payments,
    ...over,
  });
  /** What the return desk writes: the credit applied in the owner's order. */
  const returnOf = (
    o: Sale,
    credit: number,
    reason = "Returned SA — rusak",
  ): { after: Sale; debtCancelled: number } => {
    const m = applyReturnCredit({
      bill: billAfterReturns(o),
      payments: paymentsOf(o),
      refunded: refundedOf(o),
      credit,
    });
    const n = (o.adjustments ?? []).length + 1;
    return {
      debtCancelled: m.debtCancelled,
      after: {
        ...o,
        payments: m.payments,
        refunds:
          m.refund > 0
            ? [
                ...(o.refunds ?? []),
                {
                  id: `rf-${n}`,
                  method: "TUNAI",
                  amount: m.refund,
                  at: "2026-10-05T03:00:00.000Z",
                },
              ]
            : o.refunds,
        adjustments: [
          ...(o.adjustments ?? []),
          {
            id: `adj-${n}`,
            type: "RETUR",
            code: `SG-2026/10-00000${n}`,
            amount: m.credit,
            reason,
            at: "2026-10-05T03:00:00.000Z",
          },
        ],
      },
    };
  };
  const statusAfter = (o: Sale, exchanged = false) =>
    salePaymentStatus(orderBalance(o), returnedDebt(o, exchanged));

  it("reads Unpaid, returned when nothing was ever paid and the return cancelled it all", () => {
    const o = sale(8_000_000, [
      pay({ id: "o-1-owed", amount: 8_000_000, state: "DUE" }),
    ]);
    const { after, debtCancelled } = returnOf(o, 8_000_000);
    expect(debtCancelled).toBe(8_000_000);
    expect(returnedDebt(after)).toEqual({ cancelled: 8_000_000, paid: 0 });
    expect(statusAfter(after)).toBe("UNPAID_RETURNED");
    // Before this, the same sale read Settled.
    expect(salePaymentStatus(orderBalance(after))).toBe("SETTLED");
  });

  it("reads Partly paid, returned when a deposit came in, the rest was owed, and it all came back", () => {
    const o = sale(1_480_000, [
      pay({ id: "a", amount: 500_000, method: "TRANSFER" }),
      pay({ id: "o-1-owed", amount: 980_000, state: "DUE" }),
    ]);
    const { after, debtCancelled } = returnOf(o, 1_480_000);
    expect(debtCancelled).toBe(980_000);
    // The deposit is handed back; the debt is what the return cancelled.
    expect(refundedOf(after)).toBe(500_000);
    expect(returnedDebt(after)).toEqual({ cancelled: 980_000, paid: 500_000 });
    expect(statusAfter(after)).toBe("PARTLY_PAID_RETURNED");
  });

  it("keeps Settled for a sale paid in full and then returned — that is a refund, not a cancelled debt", () => {
    const o = sale(5_000_000, [pay({ amount: 5_000_000 })], { settled: true });
    const { after, debtCancelled } = returnOf(o, 5_000_000);
    expect(debtCancelled).toBe(0);
    expect(returnedDebt(after)?.cancelled).toBe(0);
    expect(statusAfter(after)).toBe("SETTLED");
  });

  it("keeps Owed while the customer still owes for what did not come back", () => {
    // Two units at 5jt, nothing paid, one returned: 5jt cancelled, 5jt owed.
    const o = sale(10_000_000, [
      pay({ id: "o-1-owed", amount: 10_000_000, state: "DUE" }),
    ]);
    const { after, debtCancelled } = returnOf(o, 5_000_000);
    expect(debtCancelled).toBe(5_000_000);
    expect(returnedDebt(after)?.cancelled).toBe(5_000_000);
    expect(statusAfter(after)).toBe("OWED");
    // The second unit back too: now the whole bill was cancelled.
    const again = returnOf(after, 5_000_000);
    expect(again.debtCancelled).toBe(5_000_000);
    expect(returnedDebt(again.after)?.cancelled).toBe(10_000_000);
    expect(statusAfter(again.after)).toBe("UNPAID_RETURNED");
  });

  it("adds up cancelled debt and refund across a payment made between two returns", () => {
    // 10jt owed; one unit (4jt) back; 3jt paid; the other (6jt) back.
    const o = sale(10_000_000, [
      pay({ id: "o-1-owed", amount: 10_000_000, state: "DUE" }),
    ]);
    const first = returnOf(o, 4_000_000).after;
    const paid: Sale = {
      ...first,
      payments: [
        pay({ id: "c", amount: 3_000_000 }),
        pay({ id: "o-1-owed", amount: 3_000_000, state: "DUE" }),
      ],
    };
    const second = returnOf(paid, 6_000_000);
    expect(second.debtCancelled).toBe(3_000_000);
    expect(refundedOf(second.after)).toBe(3_000_000);
    expect(returnedDebt(second.after)).toEqual({
      cancelled: 7_000_000,
      paid: 3_000_000,
    });
    expect(statusAfter(second.after)).toBe("PARTLY_PAID_RETURNED");
  });

  it("never reads a marketplace's cancelled money as a customer's debt", () => {
    const shopee = sale(
      6_000_000,
      [
        pay({
          amount: 6_000_000,
          state: "PENDING",
          channel: "SHOPEE",
          method: "MARKETPLACE",
          ref: "260912RGK2YKYU",
        }),
      ],
      { source: "SHOPEE" },
    );
    const back = returnOf(
      shopee,
      6_000_000,
      "Returned SA — rusak (Shopee 260912RGK2YKYU)",
    );
    expect(back.debtCancelled).toBe(0);
    expect(returnedDebt(back.after)?.cancelled).toBe(0);
    expect(statusAfter(back.after)).toBe("SETTLED");

    // A walk-in sale part on Shopee, part owed, all back: the totals cannot
    // say which half was which, so it is not called a cancelled debt.
    const mixed = sale(10_000_000, [
      pay({
        id: "a",
        amount: 4_000_000,
        state: "PENDING",
        channel: "SHOPEE",
        method: "MARKETPLACE",
        ref: "2609ABC",
      }),
      pay({ id: "o-1-owed", amount: 6_000_000, state: "DUE" }),
    ]);
    const mixedBack = returnOf(
      mixed,
      10_000_000,
      "Returned SA — rusak (Shopee 2609ABC)",
    );
    expect(mixedBack.after.payments).toEqual([]);
    expect(returnedDebt(mixedBack.after)?.cancelled).toBe(0);
  });

  it("leaves an exchange alone — its credit paid for the replacements", () => {
    const o = sale(8_000_000, [
      pay({ id: "o-1-owed", amount: 8_000_000, state: "DUE" }),
    ]);
    const { after } = returnOf(o, 8_000_000);
    expect(returnedDebt(after, true)?.cancelled).toBe(0);
    expect(statusAfter(after, true)).toBe("SETTLED");
  });

  it("is nothing on a sale no return touched", () => {
    expect(
      returnedDebt(sale(8_000_000, [pay({ amount: 8_000_000, state: "DUE" })])),
    ).toBeUndefined();
    expect(
      statusAfter(sale(8_000_000, [pay({ amount: 8_000_000, state: "DUE" })])),
    ).toBe("OWED");
  });
});

describe("exchangedSales", () => {
  const order = (id: string, code: string, serials: string[]) => ({
    id,
    code,
    serials,
    adjustments: [
      {
        id: `adj-${id}`,
        type: "RETUR" as const,
        code: "SG-2026/10-000001",
        amount: 1,
        reason: "x",
        at: "2026-10-05T03:00:00.000Z",
      },
    ],
  });
  const sold = (serial: string, at: string, refCode: string) => ({
    serial,
    type: "TERJUAL",
    at,
    refCode,
  });

  it("names a sale that took a unit out under its return's code", () => {
    const out = exchangedSales(
      [order("o-1", "SI-1", ["SA", "SB"])],
      [
        sold("SA", "2026-10-01T03:00:00.000Z", "SI-1"),
        sold("SB", "2026-10-05T03:00:00.000Z", "SG-2026/10-000001"),
      ],
      [],
    );
    expect([...out]).toEqual(["o-1"]);
  });

  it("names a sale that took a unit out under its own code after a return", () => {
    // A counted-only return names the sale on the replacement's row.
    const out = exchangedSales(
      [order("o-1", "SI-1", ["SA", "SB"])],
      [sold("SB", "2026-10-05T03:00:01.000Z", "SI-1")],
      [],
    );
    expect(out.has("o-1")).toBe(true);
  });

  it("names a sale that took counted pieces out after a return", () => {
    const out = exchangedSales(
      [order("o-1", "SI-1", ["SA"])],
      [],
      [{ type: "TERJUAL", at: "2026-10-05T03:00:00.000Z", orderId: "o-1" }],
    );
    expect(out.has("o-1")).toBe(true);
  });

  it("does not mistake the original sale, or a resale elsewhere, for an exchange", () => {
    const out = exchangedSales(
      [order("o-1", "SI-1", ["SA"])],
      [
        sold("SA", "2026-10-01T03:00:00.000Z", "SI-1"),
        // Returned, then sold again on another receipt.
        sold("SA", "2026-10-09T03:00:00.000Z", "SI-2"),
      ],
      [{ type: "TERJUAL", at: "2026-10-01T03:00:00.000Z", orderId: "o-1" }],
    );
    expect(out.size).toBe(0);
  });
});
