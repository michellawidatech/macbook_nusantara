/**
 * The Shopee cost structure (owner ask 2026-09-21).
 *
 * The two worked examples in `docs/shopee-fees.md` are the spec: each was
 * reconciled to the rupiah against a `Rincian Pesanan` screenshot the owner
 * supplied, so if either of these stops matching, either a rate has changed or
 * this file has a bug — and the document says which figures came from where.
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

describe("the worked examples from docs/shopee-fees.md", () => {
  it("reconciles order 260913W27KJ6EP to the rupiah", () => {
    // Subtotal 7.700.000, Shopee's voucher 385.000, SPayLater over 3 months,
    // an affiliate sale. Stated payout: 6.893.428.
    const facts = laptop({
      shopeeVoucher: 385_000,
      spayLater: "THREE_MONTHS",
      affiliate: true,
    });
    const fees = estimateShopeeFees(facts);
    expect(amount(fees, /Administrasi/)).toBe(404_250);
    expect(amount(fees, /Proses Pesanan/)).toBe(1_250);
    expect(amount(fees, /Gratis Ongkir/)).toBe(38_500);
    expect(amount(fees, /Promo XTRA/)).toBe(60_000);
    // 2,5% of the FINANCED amount (7.700.000 − 385.000), not of the list
    // price: 2,5% of the list would be 192.500 and nothing would reconcile.
    expect(amount(fees, /SPayLater/)).toBe(182_875);
    expect(amount(fees, /Premi/)).toBe(38_500);
    // 1% of the financed amount plus 11% PPN: 7.315.000 × 1,11% = 81.196,5.
    // Until 2026-09-21 the PPN was missing and this read 73.150; the seller
    // balance report has four more affiliate sales that all fit × 1,11.
    expect(amount(fees, /AMS/)).toBe(81_197);
    // Every one of the seven lines now traces to a rate, and the estimate IS
    // Shopee's own 6.893.428.
    expect(estimatedPayout(facts)).toBe(6_893_428);
  });

  it("reconciles order 2609166VUDCU4M exactly — no instalment, no affiliate", () => {
    // 6.800.000 − 357.000 − 1.250 − 34.000 − 60.000 − 34.000 = 6.313.750
    const facts = laptop({ gross: 6_800_000 });
    const fees = estimateShopeeFees(facts);
    expect(fees.map((f) => f.amount)).toEqual([
      357_000, // Biaya Administrasi, 5,25%
      1_250, // Biaya Proses Pesanan
      34_000, // Gratis Ongkir XTRA, the observed 0,5%
      60_000, // Promo XTRA, at its cap
      34_000, // Premi, 0,5%
    ]);
    expect(estimatedPayout(facts)).toBe(6_313_750);
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

  it("uses the half-rate the shop actually pays, and the published one on request", () => {
    expect(freeShippingFee(7_700_000, false)).toBe(38_500);
    expect(freeShippingFee(7_700_000, true)).toBe(40_000); // capped
  });

  it("leaves out the two conditional lines unless told they apply", () => {
    const fees = estimateShopeeFees(laptop());
    expect(fees.some((f) => /SPayLater/.test(f.label))).toBe(false);
    expect(fees.some((f) => /AMS/.test(f.label))).toBe(false);
    expect(fees.every((f) => f.basis === "rate")).toBe(true);
  });

  it("marks the conditional lines as conditional", () => {
    const fees = estimateShopeeFees(
      laptop({ spayLater: "SIX_MONTHS", affiliate: true }),
    );
    expect(
      fees.filter((f) => f.basis === "conditional").map((f) => f.label),
    ).toEqual(["Biaya SPayLater XTRA 0%", "Komisi AMS"]);
  });

  it("lands inside the band the document states", () => {
    // 6,9% with nothing conditional, about 12% with six months and an
    // affiliate. That spread is the whole argument for reading the payout.
    expect(effectiveCostPct(laptop({ gross: 10_290_556 }))).toBeCloseTo(
      6.86,
      1,
    );
    expect(
      effectiveCostPct(
        laptop({ gross: 10_290_556, spayLater: "SIX_MONTHS", affiliate: true }),
      ),
    ).toBeCloseTo(11.96, 1);
  });
});

describe("fitting an estimate to what Shopee actually paid", () => {
  it("adds nothing when the rates explain the payout exactly", () => {
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_313_750,
    );
    expect(unexplained).toBe(0);
    expect(fees.some((f) => f.label === OTHER_FEES_LABEL)).toBe(false);
  });

  it("names what the rates cannot explain Biaya Lainnya, instead of spreading it", () => {
    /*
     * The owner's rule (2026-09-21): "if there is discrepancies that are not
     * mentioned in the rule just add like Biaya lainnya". Spreading would be
     * the tempting version and it would hide exactly what the rates exist to
     * catch: the admin line must stay 5,25% of the subtotal so somebody can
     * see when it is not.
     */
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_200_000,
    );
    expect(unexplained).toBe(113_750);
    expect(amount(fees, /Administrasi/)).toBe(357_000);
    expect(fees.at(-1)).toMatchObject({
      kind: "OTHER",
      label: OTHER_FEES_LABEL,
      amount: 113_750,
    });
    // And the lines now add up to exactly what Shopee kept.
    const deducted = fees.reduce((n, f) => n + f.amount, 0);
    expect(6_800_000 - deducted).toBe(6_200_000);
  });

  it("writes a payout ABOVE the rates as an additional payment below zero", () => {
    // Shopee paid 86.250 more than its own fees leave room for — a
    // compensation, or a sale recorded below its Shopee price. The line is
    // money ADDED, so the lines still close on what landed.
    const { fees, unexplained } = reconcileEstimate(
      laptop({ gross: 6_800_000 }),
      6_400_000,
    );
    expect(unexplained).toBe(-86_250);
    expect(fees.at(-1)).toMatchObject({
      label: EXTRA_PAYMENT_LABEL,
      amount: -86_250,
    });
    expect(6_800_000 - fees.reduce((n, f) => n + f.amount, 0)).toBe(6_400_000);
  });

  it("reproduces the seller balance report of 1–21 Sep 2026", () => {
    /*
     * Real orders: the balance report's `Jumlah` against the order export's
     * subtotal for the same order number.
     *
     * - 2609069FJ48B50 is fully explained by the rates.
     * - 2609142KT5WTXR was declared at 5.000 gr: its 42.000 is exactly the
     *   Ukuran Khusus ongkir (Rp60.000 at the cap) less the 0,5% the rates
     *   charge — which no export can know, so it is Biaya Lainnya.
     */
    expect(
      reconcileEstimate(laptop({ gross: 5_300_000 }), 4_907_500).unexplained,
    ).toBe(0);
    const khusus = reconcileEstimate(laptop({ gross: 3_600_000 }), 3_271_750);
    expect(khusus.unexplained).toBe(42_000);
    expect(amount(khusus.fees, /Gratis Ongkir/)! + 42_000).toBe(60_000);
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
      0.5, // Gratis Ongkir XTRA
      undefined, // Promo XTRA — the Rp60.000 cap, not 4,5%
      0.5, // Premi
    ]);
    // Below the cap the 4,5% is the rule, and says so.
    const charger = estimateShopeeFees({
      gross: 500_000,
      qty: 1,
      category: "ACCESSORY",
    });
    expect(charger.find((f) => /Promo/.test(f.label))?.rate).toBe(4.5);
  });
});

describe("the rates as a validator", () => {
  it("says nothing when the stated lines fit", () => {
    expect(
      feeWarnings(laptop({ gross: 6_800_000 }), [
        { label: "Biaya Administrasi", amount: 357_000 },
        { label: "Biaya Promo XTRA", amount: 60_000 },
        { label: "Biaya Gratis Ongkir XTRA", amount: 34_000 },
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
      { label: "Biaya Gratis Ongkir XTRA", amount: 170_000 }, // 2,5%
    ]);
    expect(warnings.some((w) => /Ukuran Khusus/.test(w))).toBe(true);
  });

  it("notices the half-rate anomaly ending", () => {
    const warnings = feeWarnings(laptop({ gross: 6_800_000 }), [
      { label: "Biaya Administrasi", amount: 357_000 },
      { label: "Biaya Promo XTRA", amount: 60_000 },
      { label: "Biaya Gratis Ongkir XTRA", amount: 68_000 }, // 1%
    ]);
    expect(warnings.some((w) => /half-rate/.test(w))).toBe(true);
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
