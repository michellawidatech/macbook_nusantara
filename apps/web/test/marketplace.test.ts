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
  apportion,
  commissionOn,
  commissionPctOf,
  isEvenSplit,
  joinNote,
  mergeFees,
  payoutsOf,
  pendingByChannel,
  respreadPayout,
  seedFees,
  settlementTotals,
  splitPayout,
  type PayoutPart,
  type Settlement,
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

  it("nets a line below zero as money added to the payout", () => {
    // The Shopee upload's "Pembayaran Tambahan" (2026-09-21): Shopee paid more
    // than its own fees leave room for, and the lines must still close on what
    // landed. Clamping it to zero made the received figure disagree with its
    // own deductions. A person still cannot type one — the dialog's box stops
    // at zero, which is the mistyped-minus guard.
    const t = settlementTotals({
      gross: 10_000_000,
      fees: [
        fee({ kind: "COMMISSION", amount: 525_000 }),
        fee({ amount: -125_000 }),
      ],
    });
    expect(t.deducted).toBe(400_000);
    expect(t.expected).toBe(9_600_000);
    expect(t.needsReason).toBe(false);
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

describe("apportion", () => {
  const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0);

  it("splits exactly, the leftover rupiah to the largest remainders", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(8_850_000, [5_000_000, 3_000_000, 2_000_000])).toEqual([
      4_425_000, 2_655_000, 1_770_000,
    ]);
  });

  it("spreads a shortfall the same way, and still adds up", () => {
    const shares = apportion(-5, [1, 1]);
    expect(sum(shares)).toBe(-5);
    expect(shares).toEqual([-2, -3]);
  });

  it("stays exact past 2^53, where floating point would not", () => {
    // Rp999 billion over two sales: total × weight is ~6.7e23, far past what a
    // double holds exactly. BigInt keeps every share within one rupiah of its
    // exact value and the sum exact.
    const total = 999_999_999_999;
    const weights = [333_333_333_333, 666_666_666_667];
    const shares = apportion(total, weights);
    expect(sum(shares)).toBe(total);
    const W = BigInt(weights[0]! + weights[1]!);
    weights.forEach((w, i) => {
      const floor = Number((BigInt(total) * BigInt(w)) / W);
      expect(shares[i]! - floor).toBeGreaterThanOrEqual(0);
      expect(shares[i]! - floor).toBeLessThanOrEqual(1);
    });
  });

  it("gives nothing to a weight that is not positive", () => {
    expect(apportion(10, [0, 5, -3])).toEqual([0, 10, 0]);
    expect(apportion(10, [0, 0])).toEqual([0, 0]);
  });
});

describe("splitPayout", () => {
  const parts: PayoutPart[] = [
    { paymentId: "p-a", orderId: "o-a", gross: 5_000_000 },
    { paymentId: "p-b", orderId: "o-b", gross: 3_000_000 },
    { paymentId: "p-c", orderId: "o-c", gross: 2_000_000 },
  ];
  const fees: SettlementFee[] = [
    fee({ id: "com", kind: "COMMISSION", label: "10%", amount: 1_000_000 }),
    fee({ id: "bank", kind: "TRANSFER", amount: 6_500 }),
  ];
  let n = 0;
  const ids = () => `f${++n}`;

  it("writes one settlement per payment, each naming exactly one", () => {
    // The bug of 2026-09-19: one row whose ids were "p-a,p-b,p-c", which
    // Postgres refuses as a foreign key.
    const drafts = splitPayout(parts, { fees, received: 8_993_500 }, ids);
    expect(drafts.map((d) => [d.paymentId, d.orderId])).toEqual([
      ["p-a", "o-a"],
      ["p-b", "o-b"],
      ["p-c", "o-c"],
    ]);
  });

  it("spreads every fee line and what landed, and loses no rupiah", () => {
    const drafts = splitPayout(
      parts,
      { fees, received: 8_843_500, reason: "Marketplace fee adjustment" },
      ids,
    );
    // Each line keeps its name, and its shares add back up to it.
    for (const [k, line] of fees.entries()) {
      expect(drafts.every((d) => d.fees[k]!.kind === line.kind)).toBe(true);
      expect(drafts.reduce((t, d) => t + d.fees[k]!.amount, 0)).toBe(
        line.amount,
      );
    }
    expect(drafts.reduce((t, d) => t + d.received, 0)).toBe(8_843_500);
    // The Rp150.000 shortfall is split too, and each short sale says why.
    const short = drafts.map(
      (d) =>
        settlementTotals({ gross: d.gross, fees: d.fees, received: d.received })
          .discrepancy,
    );
    expect(short.reduce((t, x) => t + x, 0)).toBe(-150_000);
    expect(drafts.every((d) => d.reason === "Marketplace fee adjustment")).toBe(
      true,
    );
  });

  it("splits a payout that agrees into sales that each agree", () => {
    // Two independent roundings would leave a rupiah of "discrepancy" on some
    // of these; a payout nobody has a reason for must not grow one.
    const odd: PayoutPart[] = [
      { paymentId: "x", orderId: "ox", gross: 333_333 },
      { paymentId: "y", orderId: "oy", gross: 333_333 },
      { paymentId: "z", orderId: "oz", gross: 333_334 },
    ];
    const lines = [fee({ id: "c", kind: "COMMISSION", amount: 100_001 })];
    const drafts = splitPayout(
      odd,
      { fees: lines, received: 1_000_000 - 100_001 },
      ids,
    );
    for (const d of drafts) {
      const t = settlementTotals({
        gross: d.gross,
        fees: d.fees,
        received: d.received,
      });
      expect(t.discrepancy).toBe(0);
      expect(d.reason).toBeUndefined();
    }
  });

  it("names each sale's copy of a fee line on its own", () => {
    const drafts = splitPayout(parts, { fees, received: 8_993_500 }, ids);
    const all = drafts.flatMap((d) => d.fees.map((f) => f.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("does not depend on the order the sales arrive in", () => {
    // Postgres hands a payout's settlements back ordered by id; a fresh split
    // of them has to agree with the one recorded from the table's order.
    const odd = [
      { paymentId: "m", orderId: "om", gross: 1 },
      { paymentId: "k", orderId: "ok", gross: 1 },
      { paymentId: "q", orderId: "oq", gross: 1 },
    ];
    const lines = [fee({ id: "c", kind: "COMMISSION", amount: 2 })];
    const a = splitPayout(odd, { fees: lines, received: 1 }, ids);
    const b = splitPayout(
      [...odd].reverse(),
      { fees: lines, received: 1 },
      ids,
    );
    const byPayment = (ds: typeof a) =>
      Object.fromEntries(
        ds.map((d) => [d.paymentId, [d.fees[0]!.amount, d.received]]),
      );
    expect(byPayment(b)).toEqual(byPayment(a));
  });

  it("never records a sale as receiving less than nothing", () => {
    // Three one-rupiah lines over three one-rupiah sales: every tie goes to
    // the same sale, which would come out at minus two.
    const tiny = [
      { paymentId: "a", orderId: "oa", gross: 1 },
      { paymentId: "b", orderId: "ob", gross: 1 },
      { paymentId: "c", orderId: "oc", gross: 1 },
    ];
    const lines = ["1", "2", "3"].map((id) =>
      fee({ id, kind: "OTHER", amount: 1 }),
    );
    const drafts = splitPayout(tiny, { fees: lines, received: 0 }, ids);
    expect(drafts.every((d) => d.received >= 0)).toBe(true);
    expect(drafts.reduce((t, d) => t + d.received, 0)).toBe(0);
  });
});

describe("payouts, put back together", () => {
  const at = "2026-09-19T03:00:00.000Z";
  const settled = (
    over: Partial<Settlement> & Pick<Settlement, "id" | "paymentId">,
  ): Settlement => ({
    orderId: `o-${over.paymentId}`,
    channel: "SHOPEE",
    gross: 1_000_000,
    fees: [],
    received: 900_000,
    at,
    staff: "Ersen",
    ...over,
  });

  it("groups what was written together, newest first, fees merged by name", () => {
    const list = [
      settled({
        id: "s1",
        paymentId: "p1",
        fees: [
          fee({ id: "a1", kind: "COMMISSION", label: "10%", amount: 100_000 }),
        ],
      }),
      settled({
        id: "s2",
        paymentId: "p2",
        fees: [
          fee({ id: "a2", kind: "COMMISSION", label: "10%", amount: 100_000 }),
        ],
        reason: "Marketplace fee adjustment",
      }),
      settled({
        id: "s3",
        paymentId: "p3",
        channel: "TOKOPEDIA",
        at: "2026-09-19T05:00:00.000Z",
      }),
    ];
    const payouts = payoutsOf(list);
    expect(payouts.map((p) => p.settlements.map((s) => s.id))).toEqual([
      ["s3"],
      ["s1", "s2"],
    ]);
    const shopee = payouts[1]!;
    expect(shopee.gross).toBe(2_000_000);
    expect(shopee.received).toBe(1_800_000);
    expect(shopee.fees).toEqual([
      { id: "a1", kind: "COMMISSION", label: "10%", amount: 200_000 },
    ]);
    expect(shopee.reasons).toEqual(["Marketplace fee adjustment"]);
  });

  it("merges lines of the same kind and name, and only those", () => {
    expect(
      mergeFees([
        { fees: [fee({ id: "x", kind: "TRANSFER", amount: 1 })] },
        {
          fees: [
            fee({ id: "y", kind: "TRANSFER", amount: 2 }),
            fee({ id: "z", kind: "TRANSFER", label: "BCA", amount: 4 }),
          ],
        },
      ]),
    ).toEqual([
      { id: "x", kind: "TRANSFER", amount: 3 },
      { id: "z", kind: "TRANSFER", label: "BCA", amount: 4 },
    ]);
  });

  /** A payout recorded as one figure, the way the page writes it. */
  const recorded = (): Settlement[] => {
    let n = 0;
    return splitPayout(
      [
        { paymentId: "p1", orderId: "o1", gross: 5_000_000 },
        { paymentId: "p2", orderId: "o2", gross: 3_000_001 },
      ],
      {
        fees: [
          fee({ id: "com", kind: "COMMISSION", label: "10%", amount: 800_000 }),
        ],
        received: 7_200_001,
      },
      (_, i) => `fee-${i}-${++n}`,
    ).map((d, i) => ({
      ...d,
      id: `s${i}`,
      channel: "SHOPEE",
      at,
      staff: "Ersen",
    }));
  };

  it("knows a payout recorded as one figure, in whatever order it returns", () => {
    const list = recorded();
    expect(isEvenSplit(payoutsOf(list)[0]!)).toBe(true);
    expect(isEvenSplit(payoutsOf([...list].reverse())[0]!)).toBe(true);
    // Corrected sale by sale — Rp100.000 moved from one sale to the other,
    // as a report stating each order's own payout would — it is no longer one
    // figure spread, and re-spreading it would undo the correction.
    const edited = list.map((s, i) => ({
      ...s,
      received: s.received + (i === 0 ? -100_000 : 100_000),
    }));
    expect(isEvenSplit(payoutsOf(edited)[0]!)).toBe(false);
  });

  it("respreads a corrected payout, each sale keeping its own fee rows", () => {
    const payout = payoutsOf(recorded())[0]!;
    const merged = payout.fees[0]!;
    let n = 0;
    const next = respreadPayout(
      payout,
      {
        fees: [
          { ...merged, amount: 800_001 },
          fee({ id: "new", kind: "TRANSFER", label: "BCA", amount: 6_500 }),
        ],
        received: 7_193_500,
      },
      () => `added-${++n}`,
    );
    expect(next.reduce((t, s) => t + s.received, 0)).toBe(7_193_500);
    // The commission rows are edited, not replaced…
    expect(next.map((s) => s.fees[0]!.id)).toEqual(
      payout.settlements.map((s) => s.fees[0]!.id),
    );
    // …and the bank charge is a new row on each sale.
    expect(next.map((s) => s.fees[1]!.id)).toEqual(["added-1", "added-2"]);
    expect(next.reduce((t, s) => t + s.fees[1]!.amount, 0)).toBe(6_500);
    expect(isEvenSplit(payoutsOf(next)[0]!)).toBe(true);
  });

  it("corrects a single sale as exactly the figures given", () => {
    const one = payoutsOf([recorded()[0]!])[0]!;
    const [s] = respreadPayout(
      one,
      {
        fees: [{ ...one.fees[0]!, amount: 450_000 }],
        received: 4_500_000,
        reason: "Refund of a voucher",
      },
      () => "unused",
    );
    expect(s!.received).toBe(4_500_000);
    expect(s!.fees).toEqual([{ ...one.fees[0]!, amount: 450_000 }]);
    expect(s!.reason).toBe("Refund of a voucher");
  });
});

describe("joinNote", () => {
  it("adds to what a payment already says, never over it", () => {
    expect(joinNote("Shopee PayLater", "Landed in a friend's account")).toBe(
      "Shopee PayLater · Landed in a friend's account",
    );
    expect(joinNote(undefined, "  Landed in BCA  ")).toBe("Landed in BCA");
    expect(joinNote("Landed in BCA", "Landed in BCA")).toBe("Landed in BCA");
    expect(joinNote("Shopee PayLater", "   ")).toBe("Shopee PayLater");
  });
});
