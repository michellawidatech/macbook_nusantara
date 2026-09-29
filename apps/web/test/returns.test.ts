import { describe, expect, it } from "vitest";
import {
  applyReturnCredit,
  marketplaceRefs,
  planReturn,
  returnableSerials,
  saleOfReturn,
  saleOfSerial,
  splitByWeight,
  type ReturnSaleInput,
} from "../src/lib/returns.js";
import { saleBalance, type SalePayment } from "../src/lib/salePayments.js";

let n = 0;
const pay = (p: Partial<SalePayment>): SalePayment => ({
  id: `p${++n}`,
  method: "TUNAI",
  amount: 0,
  state: "SETTLED",
  at: "2026-09-01T03:00:00.000Z",
  ...p,
});

describe("a return's credit (owner brief 2026-09-19)", () => {
  it("buys a paid unit back: the whole credit is handed over", () => {
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [pay({ amount: 10_000_000 })],
      credit: 10_000_000,
    });
    expect(m).toMatchObject({
      debtCancelled: 0,
      heldCancelled: 0,
      refund: 10_000_000,
    });
  });

  it("takes an unpaid unit back by cancelling the debt, and moves no money", () => {
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [
        pay({ amount: 10_000_000, state: "DUE", dueAt: "2026-10-01" }),
      ],
      credit: 10_000_000,
    });
    expect(m).toMatchObject({ debtCancelled: 10_000_000, refund: 0 });
    expect(m.payments).toEqual([]);
  });

  it("cancels what is still owed first, and hands back only the rest", () => {
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [
        pay({ amount: 4_000_000 }),
        pay({ amount: 6_000_000, state: "DUE" }),
      ],
      credit: 10_000_000,
    });
    expect(m).toMatchObject({ debtCancelled: 6_000_000, refund: 4_000_000 });
    expect(m.payments.map((p) => [p.state, p.amount])).toEqual([
      ["SETTLED", 4_000_000],
    ]);
  });

  it("counts debt nobody wrote a row for, and edits no payment for it", () => {
    // Rp4jt paid against a Rp10jt bill, and nothing else recorded.
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [pay({ amount: 4_000_000 })],
      credit: 7_000_000,
    });
    expect(m).toMatchObject({ debtCancelled: 6_000_000, refund: 1_000_000 });
    expect(m.payments.map((p) => p.amount)).toEqual([4_000_000]);
  });

  it("leaves a marketplace's money to the marketplace", () => {
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [
        pay({ amount: 10_000_000, state: "PENDING", channel: "SHOPEE" }),
      ],
      credit: 10_000_000,
    });
    expect(m).toMatchObject({ heldCancelled: 10_000_000, refund: 0 });
  });

  it("hands back less when an additional expense lowers the credit", () => {
    const m = applyReturnCredit({
      bill: 10_000_000,
      payments: [pay({ amount: 10_000_000 })],
      credit: 8_000_000,
    });
    expect(m.refund).toBe(8_000_000);
  });

  it("never hands back more than the shop holds from the sale", () => {
    // An earlier return already took Rp9jt off the bill and handed it back.
    const m = applyReturnCredit({
      bill: 1_000_000,
      payments: [pay({ amount: 10_000_000 })],
      refunded: 9_000_000,
      credit: 5_000_000,
    });
    expect(m.refund).toBe(1_000_000);
  });
});

describe("splitting a sale's applied credit over what came back on it", () => {
  it("adds back up to the whole, by weight", () => {
    const parts = splitByWeight(10_000_001, [5_000_000, 5_000_000]);
    expect(parts.reduce((t, x) => t + x, 0)).toBe(10_000_001);
    expect(parts).toEqual([5_000_001, 5_000_000]);
    expect(splitByWeight(9_000_000, [6_000_000, 3_000_000])).toEqual([
      6_000_000, 3_000_000,
    ]);
  });

  it("gives a unit worth nothing back nothing — an adjustment of zero", () => {
    expect(splitByWeight(4_000_000, [0, 4_000_000])).toEqual([0, 4_000_000]);
    // Part of a sale's credit used by an exchange, spread by worth.
    expect(splitByWeight(5_000_000, [6_000_000, 4_000_000])).toEqual([
      3_000_000, 2_000_000,
    ]);
    expect(splitByWeight(0, [6_000_000, 4_000_000])).toEqual([0, 0]);
  });
});

/** A sale as `planReturn` reads one, its balance taken as recorded. */
const sale = (
  id: string,
  credit: number,
  payments: SalePayment[],
  bill = payments.reduce((t, p) => t + p.amount, 0),
): ReturnSaleInput => ({
  id,
  code: id.toUpperCase(),
  bill,
  payments,
  credit,
});

const ids = () => {
  let k = 0;
  return () => `new-${++k}`;
};

const plan = (
  sales: ReturnSaleInput[],
  exchange?: { total: number; into: string },
) =>
  planReturn({
    sales,
    ...(exchange === undefined ? {} : { exchange }),
    method: "TRANSFER",
    at: "2026-09-21T05:00:00.000Z",
    code: "SG-1",
    newId: ids(),
  });

const parts = (ps: readonly SalePayment[]) =>
  ps.map((p) => [p.state, p.amount]);

/** A sale's balance after the plan, its new bill given. */
const after = (
  input: ReturnSaleInput,
  planned: { applied: number; payments: readonly SalePayment[] },
  replacements = 0,
) =>
  saleBalance(
    input.bill - planned.applied + replacements,
    planned.payments,
    input.refunded ?? 0,
  );

describe("a plain return over several sales (owner, 2026-09-21)", () => {
  it("settles each sale on its own, and hands back the sum", () => {
    const a = sale("si-1", 10_000_000, [pay({ amount: 10_000_000 })]);
    const b = sale("si-2", 8_000_000, [
      pay({ amount: 8_000_000, state: "DUE" }),
    ]);
    const p = plan([a, b]);
    expect(p.exchange).toBe(false);
    expect(p.refund).toBe(10_000_000);
    expect(p.sales.map((s) => [s.id, s.applied, s.refund])).toEqual([
      ["si-1", 10_000_000, 10_000_000],
      ["si-2", 8_000_000, 0],
    ]);
    expect(p.sales[1]!.payments).toEqual([]);
  });
});

describe("an exchange (owner, 2026-09-21)", () => {
  it("keeps the money when the replacement is cheaper — nothing goes back", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    const p = plan([a], { total: 8, into: "si-1" });
    expect(p).toMatchObject({ refund: 0, topUp: 0, unused: 2 });
    const s = p.sales[0]!;
    expect(s.applied).toBe(8);
    expect(parts(s.payments)).toEqual([["SETTLED", 10]]);
    // The sale is still worth 10 and is still paid 10.
    expect(after(a, s, 8)).toMatchObject({ total: 10, fullySettled: true });
  });

  it("takes the difference when the replacement costs more", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    const p = plan([a], { total: 12, into: "si-1" });
    expect(p.topUp).toBe(2);
    const s = p.sales[0]!;
    expect(s.applied).toBe(10);
    expect(s.payments.map((x) => [x.state, x.amount, x.method])).toEqual([
      ["SETTLED", 10, "TUNAI"],
      ["SETTLED", 2, "TRANSFER"],
    ]);
    expect(s.payments[1]).toMatchObject({
      id: "new-1",
      at: "2026-09-21T05:00:00.000Z",
      note: "Exchange top-up (SG-1)",
    });
    expect(after(a, s, 12)).toMatchObject({ total: 12, fullySettled: true });
  });

  it("leaves an unpaid sale owing what the replacement costs", () => {
    const a = sale("si-1", 10, [pay({ amount: 10, state: "DUE" })]);
    const p = plan([a], { total: 8, into: "si-1" });
    expect(p.topUp).toBe(0);
    const s = p.sales[0]!;
    expect(s.applied).toBe(10);
    expect(parts(s.payments)).toEqual([["DUE", 8]]);
    expect(after(a, s, 8)).toMatchObject({ customerOwes: 8, settled: 0 });
  });

  it("keeps an unpaid sale's debt when the replacement costs more", () => {
    const a = sale("si-1", 10, [pay({ amount: 10, state: "DUE" })]);
    const p = plan([a], { total: 12, into: "si-1" });
    expect(p.topUp).toBe(2);
    const s = p.sales[0]!;
    expect(parts(s.payments)).toEqual([
      ["DUE", 10],
      ["SETTLED", 2],
    ]);
    expect(after(a, s, 12)).toMatchObject({ customerOwes: 10 });
  });

  it("leaves what a marketplace holds alone when the replacement is cheaper", () => {
    const a = sale("si-1", 17, [
      pay({
        amount: 17,
        state: "PENDING",
        channel: "SHOPEE",
        ref: "260912RGK2YKYU",
      }),
    ]);
    const p = plan([a], { total: 15, into: "si-1" });
    const s = p.sales[0]!;
    expect(s.applied).toBe(15);
    expect(s.payments).toEqual(a.payments);
    expect(p).toMatchObject({ refund: 0, topUp: 0 });
  });

  it("moves another sale's money onto the sale taking the replacements", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    const paidB = pay({
      amount: 8,
      method: "TRANSFER",
      at: "2026-08-02T03:00:00.000Z",
    });
    const b = sale("si-2", 8, [paidB]);
    // 12 + 5 + 3: three replacements, on SI-1.
    const p = plan([a, b], { total: 20, into: "si-1" });
    expect(p).toMatchObject({ topUp: 2, refund: 0, into: "si-1" });
    const [s1, s2] = p.sales;
    expect(s2).toMatchObject({ applied: 8, movedOut: 8, payments: [] });
    expect(s1).toMatchObject({ applied: 10, movedIn: 8, topUp: 2 });
    expect(s1!.payments.map((x) => [x.method, x.amount])).toEqual([
      ["TUNAI", 10],
      ["TRANSFER", 8],
      ["TRANSFER", 2],
    ]);
    // The moved part is SI-2's money: its method, and the day it arrived.
    expect(s1!.payments[1]).toMatchObject({
      state: "SETTLED",
      at: "2026-08-02T03:00:00.000Z",
      note: "Moved from SI-2 — exchange SG-1",
    });
    expect(s1!.payments[1]!.id).not.toBe(paidB.id);
    expect(after(a, s1!, 20)).toMatchObject({ total: 20, fullySettled: true });
    expect(after(b, s2!)).toMatchObject({ total: 0, fullySettled: true });
  });

  it("moves nothing when the sale taking the replacements covers them itself", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    const b = sale("si-2", 8, [pay({ amount: 8 })]);
    const p = plan([a, b], { total: 5, into: "si-1" });
    const [s1, s2] = p.sales;
    expect(s1).toMatchObject({ applied: 5, movedIn: 0 });
    expect(s2).toMatchObject({ applied: 0, movedOut: 0 });
    expect(parts(s2!.payments)).toEqual([["SETTLED", 8]]);
    expect(p).toMatchObject({ refund: 0, topUp: 0, unused: 13 });
  });

  it("moves paid money onto an unpaid sale, and cuts what it still owes", () => {
    const a = sale("si-1", 10, [pay({ amount: 10, state: "DUE" })]);
    const b = sale("si-2", 8, [pay({ amount: 8 })]);
    const p = plan([a, b], { total: 12, into: "si-1" });
    const [s1, s2] = p.sales;
    expect(p.topUp).toBe(0);
    expect(s2).toMatchObject({ applied: 8, movedOut: 8, payments: [] });
    expect(s1!.applied).toBe(10);
    expect(parts(s1!.payments)).toEqual([
      ["DUE", 4],
      ["SETTLED", 8],
    ]);
    expect(after(a, s1!, 12)).toMatchObject({ customerOwes: 4 });
  });

  it("cancels another sale's own debt before anything of it can move", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    // Rp20 bill, Rp12 paid, Rp8 promised; one unit worth 10 comes back.
    const b = sale(
      "si-2",
      10,
      [pay({ amount: 12 }), pay({ amount: 8, state: "DUE" })],
      20,
    );
    const p = plan([a, b], { total: 15, into: "si-1" });
    const [s1, s2] = p.sales;
    // 8 of its credit cancels its own debt; 2 of what was paid moves.
    expect(s2).toMatchObject({ applied: 10, debtCancelled: 8, movedOut: 2 });
    expect(parts(s2!.payments)).toEqual([["SETTLED", 10]]);
    expect(after(b, s2!)).toMatchObject({ total: 10, fullySettled: true });
    expect(s1).toMatchObject({ applied: 10, movedIn: 2, topUp: 3 });
    expect(after(a, s1!, 15)).toMatchObject({ total: 15, fullySettled: true });
  });

  it("moves settled money before a marketplace's, and keeps its reference", () => {
    const a = sale("si-1", 0, []);
    const b = sale("si-2", 9, [
      pay({ amount: 4 }),
      pay({
        amount: 5,
        state: "PENDING",
        channel: "SHOPEE",
        ref: "2609166BNSSUEK",
      }),
    ]);
    const p = plan([a, b], { total: 6, into: "si-1" });
    const [s1, s2] = p.sales;
    expect(parts(s2!.payments)).toEqual([["PENDING", 3]]);
    expect(s1!.payments.map((x) => [x.state, x.amount, x.ref])).toEqual([
      ["SETTLED", 4, undefined],
      ["PENDING", 2, "2609166BNSSUEK"],
    ]);
    expect(s1!.payments[1]!.channel).toBe("SHOPEE");
  });

  it("never moves money an earlier refund already handed back", () => {
    const a = sale("si-1", 0, []);
    // Paid 10, of which 6 was handed back on an earlier return.
    const b: ReturnSaleInput = {
      ...sale("si-2", 4, [pay({ amount: 10 })], 4),
      refunded: 6,
    };
    const p = plan([a, b], { total: 9, into: "si-1" });
    const [s1, s2] = p.sales;
    expect(s2).toMatchObject({ movedOut: 4, applied: 4 });
    expect(after(b, s2!)).toMatchObject({ total: 0, settled: 0 });
    expect(s1).toMatchObject({ movedIn: 4, topUp: 5 });
  });

  it("counts a unit given away at Rp0 as an exchange: nothing goes back", () => {
    const a = sale("si-1", 10, [pay({ amount: 10 })]);
    const p = plan([a], { total: 0, into: "si-1" });
    expect(p).toMatchObject({ exchange: true, refund: 0, topUp: 0 });
    expect(p.sales[0]!.applied).toBe(0);
  });
});

describe("which sale a return is about", () => {
  const order = (id: string, ts: string, serials: string[], adj?: string) => ({
    id,
    code: id.toUpperCase(),
    ts,
    customerId: null,
    serials,
    prices: Object.fromEntries(serials.map((s) => [s, 1_000_000])),
    total: 1_000_000 * serials.length,
    payMethod: "TUNAI",
    settled: true,
    source: "OFFLINE",
    ...(adj
      ? {
          adjustments: [
            {
              id: `a-${id}`,
              type: "RETUR" as const,
              code: adj,
              amount: 1_000_000,
              reason: "x",
              at: ts,
            },
          ],
        }
      : {}),
  });

  it("takes the newest receipt of a unit that was sold twice", () => {
    const orders = [
      order("o1", "2026-08-01T00:00:00.000Z", ["S1"]),
      order("o2", "2026-09-01T00:00:00.000Z", ["S1"]),
    ];
    expect(saleOfSerial(orders, "S1")?.id).toBe("o2");
  });

  it("offers a unit back only on the receipt it is still out on", () => {
    const o1 = order("o1", "2026-08-01T00:00:00.000Z", ["S1", "S2", "S3"]);
    const o2 = order("o2", "2026-09-01T00:00:00.000Z", ["S1"]);
    const status: Record<string, string> = {
      S1: "TERJUAL",
      S2: "TERJUAL",
      S3: "TERSEDIA",
    };
    const pending = new Set(["S2"]);
    // S1 was returned and sold again on o2; S2 is already on its way back;
    // S3 is on the shelf.
    expect(returnableSerials(o1, [o1, o2], (s) => status[s], pending)).toEqual(
      [],
    );
    expect(returnableSerials(o2, [o1, o2], (s) => status[s], pending)).toEqual([
      "S1",
    ]);
  });

  it("reads a return's sale off its SG code, else off the date", () => {
    const orders = [
      order("o1", "2026-08-01T00:00:00.000Z", ["S1"], "SG-1"),
      order("o2", "2026-09-10T00:00:00.000Z", ["S1"]),
    ];
    expect(
      saleOfReturn(orders, { code: "SG-1", serial: "S1", date: "2026-09-15" })
        ?.id,
    ).toBe("o1");
    expect(
      saleOfReturn(orders, { code: "SG-9", serial: "S1", date: "2026-08-20" })
        ?.id,
    ).toBe("o1");
  });
});

describe("the marketplace numbers a return's reason keeps", () => {
  it("names each order number once, with its marketplace", () => {
    expect(
      marketplaceRefs(
        [
          pay({ ref: "260912RGK2YKYU", channel: "SHOPEE", state: "PENDING" }),
          pay({ ref: "260912RGK2YKYU", channel: "SHOPEE", state: "PENDING" }),
          pay({ ref: "INV/2026/TKP/1", channel: "TOKOPEDIA" }),
          pay({}),
        ],
        "OFFLINE",
      ),
    ).toEqual(["Shopee 260912RGK2YKYU", "Tokopedia INV/2026/TKP/1"]);
    // A reference on a cash part of a Shopee sale is the sale's channel's.
    expect(marketplaceRefs([pay({ ref: "2609166BNSSUEK" })], "SHOPEE")).toEqual(
      ["Shopee 2609166BNSSUEK"],
    );
  });
});
