/**
 * The Shopee cost structure (owner ask 2026-09-21, revised 2026-11-15).
 *
 * The four November orders the owner sent as screenshots are the spec: each
 * is reconciled to the rupiah against its own `Rincian Penghasilan`. If one
 * stops matching, either a rate has changed or this file has a bug —
 * docs/shopee-fees.md says which figures came from where.
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_PCT,
  estimateShopeeFees,
  estimatedPayout,
  effectiveCostPct,
  feeWarnings,
  freeShippingFee,
  promoXtraFee,
  closeOnPayout,
  EXTRA_PAYMENT_LABEL,
  OTHER_FEES_LABEL,
  reconcileEstimate,
  statedFee,
  toSettlementFees,
  type ShopeeSaleFacts,
} from "../src/lib/shopeeFees.js";

const laptop = (over: Partial<ShopeeSaleFacts> = {}): ShopeeSaleFacts => ({
  gross: 7_700_000,
  qty: 1,
  category: "LAPTOP",
  ...over,
});

const amount = (
  fees: readonly { label: string; amount: number }[],
  re: RegExp,
) => fees.find((f) => re.test(f.label))?.amount;

describe("the owner's November 2026 orders", () => {
  it("reconciles 261106JAT13UX9 exactly with the fixed lines alone", () => {
    // 6.800.000 − 358.250 − 40.000 − 60.000 − 34.000 − 34.000 = 6.273.750
    const facts = laptop({ gross: 6_800_000 });
    expect(estimateShopeeFees(facts).map((f) => [f.label, f.amount])).toEqual([
      ["Biaya Administrasi", 357_000], // 5,25%
      ["Biaya Proses Pesanan", 1_250],
      ["Biaya Gratis Ongkir XTRA", 40_000], // 1%, at its Rp40.000 cap
      ["Biaya Promo XTRA", 60_000], // 4,5%, at its Rp60.000 cap
      ["Premi", 34_000], // 0,5%
      ["PPh 22", 34_000], // 0,5%
    ]);
    expect(estimatedPayout(facts)).toBe(6_273_750);
  });

  it("reconciles 261104DUGE3658, an affiliate sale, with AMS as Others", () => {
    // Rp10.450.000 paid out 9.588.910; the Rp106.715 Komisi AMS is the one
    // line the price cannot predict.
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 10_450_000 }),
      9_588_910,
    );
    expect(amount(fees, /Administrasi/)).toBe(548_625);
    expect(amount(fees, /Gratis Ongkir/)).toBe(40_000);
    expect(amount(fees, /Premi/)).toBe(52_250);
    expect(amount(fees, /PPh 22/)).toBe(52_250);
    expect(unexplained).toBe(106_715);
    expect(fees.at(-1)).toMatchObject({
      label: OTHER_FEES_LABEL,
      amount: 106_715,
    });
  });

  it("reconciles 261105GSHFNT9H: the ongkir cap holds at Rp39,6jt", () => {
    // The old 0,5% uncapped rate would have charged 198.000 here.
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 39_600_000 }),
      36_595_290,
    );
    expect(amount(fees, /Administrasi/)).toBe(2_079_000);
    expect(amount(fees, /Gratis Ongkir/)).toBe(40_000);
    expect(amount(fees, /PPh 22/)).toBe(198_000);
    expect(unexplained).toBe(428_460); // Komisi AMS
  });

  it("puts 261105FKC901NR's Biaya Transaksi in Others", () => {
    // 6.800.000 with a Rp157.500 Biaya Transaksi on top of the fixed lines.
    const { unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_116_250,
    );
    expect(unexplained).toBe(157_500);
  });
});

describe("the rules behind the rates", () => {
  it("charges an accessory the accessory admin rate", () => {
    // ⚠️ The single most expensive thing to hard-code. Aksesoris Desktop &
    // Laptop — a charger — is 6,75%, not 5,25%.
    const charger = { gross: 500_000, qty: 1, category: "ACCESSORY" } as const;
    expect(amount(estimateShopeeFees(charger), /Administrasi/)).toBe(33_750);
    expect(ADMIN_PCT.ACCESSORY).toBeGreaterThan(ADMIN_PCT.LAPTOP);
  });

  it("caps Promo XTRA per UNIT, not per order", () => {
    // The cap binds on every laptop; two of them is two caps.
    expect(promoXtraFee(7_700_000, 1)).toBe(60_000);
    expect(promoXtraFee(7_700_000, 2)).toBe(120_000);
  });

  it("applies the 4,5% below the cap, which is where an accessory sits", () => {
    // Breakeven is Rp1.333.333. A Rp500.000 charger pays 22.500, and
    // hard-coding the cap would over-charge it by Rp37.500.
    expect(promoXtraFee(500_000, 1)).toBe(22_500);
  });

  it("charges Gratis Ongkir XTRA at 1%, capped at Rp40.000", () => {
    expect(freeShippingFee(2_000_000)).toBe(20_000);
    expect(freeShippingFee(7_700_000)).toBe(40_000);
    expect(freeShippingFee(39_600_000)).toBe(40_000);
  });

  it("estimates the fixed lines only — no affiliate, no payment-method fee", () => {
    const fees = estimateShopeeFees(laptop());
    expect(fees.some((f) => /AMS|SPayLater|Transaksi/.test(f.label))).toBe(
      false,
    );
    expect(fees.every((f) => f.basis === "rate")).toBe(true);
  });

  it("costs a laptop sale 6,25% + Rp101.250", () => {
    // At Rp10jt: 625.000 + 101.250 = 726.250, 7,26%.
    expect(effectiveCostPct(laptop({ gross: 10_000_000 }))).toBeCloseTo(
      7.26,
      2,
    );
  });
});

describe("fitting an estimate to what Shopee actually paid", () => {
  it("adds nothing when the rates explain the payout exactly", () => {
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_273_750,
    );
    expect(unexplained).toBe(0);
    expect(fees.some((f) => f.label === OTHER_FEES_LABEL)).toBe(false);
  });

  it("names what the rates cannot explain Others, instead of spreading it", () => {
    /*
     * The owner's rule (2026-09-21): "if there is discrepancies that are not
     * mentioned in the rule just add like Biaya lainnya" — Others since
     * 2026-11-15. Spreading would be
     * the tempting version and it would hide exactly what the rates exist to
     * catch: the admin line must stay 5,25% of the subtotal so somebody can
     * see when it is not.
     */
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_200_000,
    );
    expect(unexplained).toBe(73_750);
    expect(amount(fees, /Administrasi/)).toBe(357_000);
    expect(fees.at(-1)).toMatchObject({
      kind: "OTHER",
      label: OTHER_FEES_LABEL,
      amount: 73_750,
    });
    // And the lines now add up to exactly what Shopee kept.
    const deducted = fees.reduce((n, f) => n + f.amount, 0);
    expect(6_800_000 - deducted).toBe(6_200_000);
  });

  it("writes a payout ABOVE the rates as an additional payment below zero", () => {
    // Shopee paid 126.250 more than its own fees leave room for — a
    // compensation, or a sale recorded below its Shopee price. The line is
    // money ADDED, so the lines still close on what landed.
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_400_000,
    );
    expect(unexplained).toBe(-126_250);
    expect(fees.at(-1)).toMatchObject({
      label: EXTRA_PAYMENT_LABEL,
      amount: -126_250,
    });
    expect(6_800_000 - fees.reduce((n, f) => n + f.amount, 0)).toBe(6_400_000);
  });

  it("closes a report's OWN fee lines on its payout too", () => {
    // An income report that printed three lines and a payout they do not add
    // up to: the gap is named, never absorbed.
    const { fees, unexplained } = closeOnPayout(
      [
        statedFee("Biaya Administrasi", 357_000),
        statedFee("Biaya Proses Pesanan", 1_250),
      ],
      6_800_000,
      6_400_000,
    );
    expect(unexplained).toBe(41_750);
    expect(fees.map((f) => f.label)).toEqual([
      "Biaya Administrasi",
      "Biaya Proses Pesanan",
      OTHER_FEES_LABEL,
    ]);
  });

  it("files a printed line under its bucket and keeps Shopee's name", () => {
    expect(statedFee("Biaya Administrasi", 1).kind).toBe("COMMISSION");
    expect(statedFee("Biaya Gratis Ongkir XTRA", 1).kind).toBe("SERVICE");
    expect(statedFee("Komisi AMS", 1).kind).toBe("PROMOTION");
    expect(statedFee("Biaya Transaksi", 1).kind).toBe("SERVICE");
    expect(statedFee("PPh 22", 1).kind).toBe("OTHER");
    expect(statedFee("Premi", 1)).toMatchObject({
      kind: "OTHER",
      label: "Premi",
      basis: "stated",
    });
  });

  it("prints the rate beside a percentage line, and none where a cap took over", () => {
    const fees = estimateShopeeFees(laptop({ gross: 6_800_000 }));
    expect(fees.map((f) => f.rate)).toEqual([
      5.25, // Biaya Administrasi
      undefined, // Biaya Proses Pesanan — flat
      undefined, // Gratis Ongkir XTRA — the Rp40.000 cap, not 1%
      undefined, // Promo XTRA — the Rp60.000 cap, not 4,5%
      0.5, // Premi
      0.5, // PPh 22
    ]);
    // Below the cap the 4,5% is the rule, and says so.
    const charger = estimateShopeeFees({
      gross: 500_000,
      qty: 1,
      category: "ACCESSORY",
    });
    expect(charger.find((f) => /Promo/.test(f.label))?.rate).toBe(4.5);
    expect(charger.find((f) => /Ongkir/.test(f.label))?.rate).toBe(1);
  });
});

describe("the rates as a validator", () => {
  it("says nothing when the stated lines fit", () => {
    expect(
      feeWarnings(laptop({ gross: 6_800_000 }), [
        { label: "Biaya Administrasi", amount: 357_000 },
        { label: "Biaya Promo XTRA", amount: 60_000 },
        { label: "Biaya Gratis Ongkir XTRA", amount: 40_000 },
      ]),
    ).toEqual([]);
  });

  it("catches an accessory booked as a laptop, and says so", () => {
    const warnings = feeWarnings(laptop({ gross: 6_800_000 }), [
      { label: "Biaya Administrasi", amount: 459_000 }, // 6,75%
      { label: "Biaya Promo XTRA", amount: 60_000 },
    ]);
    expect(warnings[0]).toMatch(/wrong Shopee category/);
  });

  it("catches a lapsed Promo XTRA", () => {
    expect(
      feeWarnings(laptop({ gross: 6_800_000 }), [
        { label: "Biaya Administrasi", amount: 357_000 },
      ]),
    ).toContain("No Promo XTRA line — the programme may have lapsed.");
  });

  it("catches the Ukuran Khusus band, which is the 5 kg listing problem", () => {
    const warnings = feeWarnings(laptop({ gross: 6_800_000 }), [
      { label: "Biaya Administrasi", amount: 357_000 },
      { label: "Biaya Promo XTRA", amount: 60_000 },
      { label: "Biaya Gratis Ongkir XTRA", amount: 60_000 }, // 2,5%, capped
    ]);
    expect(warnings.some((w) => /Rp60\.000.*Ukuran Khusus/.test(w))).toBe(true);
  });
});

describe("toSettlementFees", () => {
  it("gives each line an id and keeps its label", () => {
    let n = 0;
    const rows = toSettlementFees(
      estimateShopeeFees(laptop()),
      () => `f${++n}`,
    );
    expect(rows[0]).toEqual({
      id: "f1",
      kind: "COMMISSION",
      label: "Biaya Administrasi",
      amount: 404_250,
    });
  });
});
