import { describe, expect, it } from "vitest";
import { diffPayments } from "../src/lib/paymentEdits.js";
import type { SalePayment } from "../src/lib/salePayments.js";

const pay = (over: Partial<SalePayment>): SalePayment => ({
  id: "p1",
  method: "TUNAI",
  amount: 1_000_000,
  state: "SETTLED",
  at: "2026-09-08T03:00:00.000Z",
  ...over,
});

const ctx = { at: "2026-09-08T04:00:00.000Z", staff: "Michella" };

describe("diffPayments", () => {
  it("records a corrected amount with both figures", () => {
    // The whole reason the log exists: the number BEFORE the edit is the one
    // that answers a customer disputing a balance next month.
    const log = diffPayments(
      [pay({ amount: 5_000_000 })],
      [pay({ amount: 500_000 })],
      { ...ctx, reason: "Typed a zero too many" },
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "AMENDED",
      before: { amount: 5_000_000, state: "SETTLED" },
      after: { amount: 500_000, state: "SETTLED" },
      reason: "Typed a zero too many",
    });
  });

  it("records a state change", () => {
    // A marketplace paying out is a real correction, and a real one to be able
    // to look back at when the bank statement disagrees.
    const log = diffPayments(
      [pay({ state: "PENDING" })],
      [pay({ state: "SETTLED" })],
      ctx,
    );
    expect(log[0]).toMatchObject({ action: "AMENDED" });
  });

  it("says nothing about a note somebody tidied", () => {
    // Fixing a typo in a note is not a financial correction, and a log full of
    // them is a log nobody reads.
    expect(
      diffPayments([pay({ note: "dp" })], [pay({ note: "DP" })], ctx),
    ).toEqual([]);
  });

  it("records an addition and a removal", () => {
    const log = diffPayments(
      [pay({ id: "a" })],
      [pay({ id: "b", amount: 2_000_000 })],
      ctx,
    );
    // Removals first, then amendments, then additions — what went, what moved,
    // what arrived.
    expect(log.map((e) => e.action)).toEqual(["REMOVED", "ADDED"]);
    expect(log[0]).toMatchObject({ paymentId: "a" });
    expect(log[1]).toMatchObject({ paymentId: "b" });
  });

  it("keeps a removed payment's figures", () => {
    // Nothing is deleted: the row that went leaves its number behind it.
    const log = diffPayments([pay({ amount: 750_000 })], [], ctx);
    expect(log[0]).toMatchObject({
      action: "REMOVED",
      before: { amount: 750_000, state: "SETTLED" },
    });
    expect(log[0]!.after).toBeUndefined();
  });

  it("says nothing when nothing changed", () => {
    const same = [pay({})];
    expect(diffPayments(same, [pay({})], ctx)).toEqual([]);
  });
});
