/**
 * What the marketplace kept, and what actually landed.
 *
 * The owner's ask of 2026-09-08: the system knew a Shopee sale was unsettled
 * and knew what finally arrived, and could not say WHY the two differed. See
 * `lib/marketplace.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_PCT,
  commissionOn,
  commissionPctOf,
  pendingByChannel,
  seedFees,
  settlementTotals,
  type SettlementFee,
} from "../src/lib/marketplace.js";

const fee = (over: Partial<SettlementFee>): SettlementFee => ({
  id: "f1",
  kind: "OTHER",
  amount: 0,
  ...over,
});

describe("commissionPctOf", () => {
  it("uses the shop's rate for a channel, and the default otherwise", () => {
    expect(commissionPctOf("SHOPEE", { SHOPEE: 8 })).toBe(8);
    expect(commissionPctOf("TOKOPEDIA", { SHOPEE: 8 })).toBe(
      DEFAULT_COMMISSION_PCT,
    );
    expect(commissionPctOf("SHOPEE", undefined)).toBe(DEFAULT_COMMISSION_PCT);
  });

  it("is the owner's ten per cent by default", () => {
    expect(DEFAULT_COMMISSION_PCT).toBe(10);
  });
});

describe("commissionOn", () => {
  it("takes the percentage off the gross", () => {
    expect(commissionOn(10_000_000, 10)).toBe(1_000_000);
  });

  it("rounds DOWN, so a rounding artefact never reads as a shortfall", () => {
    // Predicting a fee larger than the one charged makes the shop expect less
    // than arrives, which reads as "they took less than we thought". The other
    // direction reads as money missing, and a false alarm costs somebody an
    // afternoon on a marketplace dashboard.
    expect(commissionOn(1_234_567, 10)).toBe(123_456);
  });

  it("answers zero for nothing", () => {
    expect(commissionOn(0, 10)).toBe(0);
    expect(commissionOn(-5, 10)).toBe(0);
    expect(commissionOn(10_000_000, -5)).toBe(0);
  });
});

describe("settlementTotals", () => {
  it("itemises the deductions instead of netting them", () => {
    // The whole feature: "the existing system don't keep track of which fee is
    // which and what the adjustment is for".
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [
        fee({ id: "a", kind: "COMMISSION", amount: 1_000_000 }),
        fee({ id: "b", kind: "TRANSFER", amount: 6_500 }),
      ],
    });
    expect(t.deducted).toBe(1_006_500);
    expect(t.expected).toBe(8_993_500);
    expect(t.byKind.COMMISSION).toBe(1_000_000);
    expect(t.byKind.TRANSFER).toBe(6_500);
    expect(t.byKind.SERVICE).toBe(0);
  });

  it("opens with the expectation in the box and nothing to explain", () => {
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [fee({ kind: "COMMISSION", amount: 1_000_000 })],
    });
    expect(t.received).toBe(9_000_000);
    expect(t.discrepancy).toBe(0);
    expect(t.needsReason).toBe(false);
  });

  it("shows a shortfall the fees do not explain, and asks for a sentence", () => {
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [fee({ kind: "COMMISSION", amount: 1_000_000 })],
      received: 8_850_000,
    });
    expect(t.discrepancy).toBe(-150_000);
    expect(t.needsReason).toBe(true);
  });

  it("shows a surplus too", () => {
    // Over-estimating a fee, or a refund landing in the same payout. Both are
    // worth a sentence, and neither is an error the shop should absorb.
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [fee({ kind: "COMMISSION", amount: 1_000_000 })],
      received: 9_200_000,
    });
    expect(t.discrepancy).toBe(200_000);
    expect(t.needsReason).toBe(true);
  });

  it("refuses a negative fee rather than netting it", () => {
    // Money coming back is not a fee, and a mistyped minus would quietly
    // inflate what the shop thinks it is owed.
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [fee({ amount: -500_000 })],
    });
    expect(t.deducted).toBe(0);
    expect(t.expected).toBe(10_000_000);
  });
});

describe("seedFees", () => {
  it("starts a withdrawal with the commission and nothing else", () => {
    // One line rather than a blank form: the commission is on every payout and
    // is the one the shop can compute in advance. The bank charge is "often
    // times", so it is typed.
    const fees = seedFees(10_000_000, "SHOPEE", { SHOPEE: 8 }, "f");
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ kind: "COMMISSION", amount: 800_000 });
    expect(fees[0]!.label).toBe("8%");
  });
});

describe("pendingByChannel", () => {
  it("groups by the channel holding the money, biggest first", () => {
    // Per channel because withdrawing is a per-channel errand — somebody signs
    // in to Shopee and presses a button there, then does it again on Tokopedia.
    const rows = pendingByChannel(
      [
        { amount: 5_000_000, state: "PENDING", channel: "SHOPEE" },
        { amount: 3_000_000, state: "PENDING", channel: "SHOPEE" },
        { amount: 9_000_000, state: "PENDING", channel: "TOKOPEDIA" },
        { amount: 4_000_000, state: "SETTLED", channel: "SHOPEE" },
        { amount: 1_000_000, state: "DUE" },
      ],
      { SHOPEE: 10, TOKOPEDIA: 5 },
    );
    expect(rows.map((r) => r.channel)).toEqual(["TOKOPEDIA", "SHOPEE"]);
    expect(rows[1]).toMatchObject({ gross: 8_000_000, count: 2 });
    // What would land if the fees behave as the rule predicts.
    expect(rows[0]!.expected).toBe(8_550_000);
  });

  it("ignores everything that is not pending", () => {
    expect(
      pendingByChannel([{ amount: 5_000_000, state: "SETTLED" }], undefined),
    ).toEqual([]);
  });
});
