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
import { saleBalance, type SalePayment } from "../src/lib/salePayments.js";
import {
  paymentRefOf,
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
