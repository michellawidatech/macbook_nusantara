/**
 * What a Shopee sale costs this shop, as code.
 *
 * > *"For pending payment from shopee, add a upload excel. See the previous
 * > conversation about the cost structure in the md files. Then now the user
 * > can upload the file and the pending transaction will be calculated
 * > against the cost structure."*
 * > — owner, 2026-09-21
 *
 * `docs/shopee-fees.md` is where these rates come from and what each one was
 * checked against; this file is that document made executable. Every constant
 * below has a line in it, and the two worked examples there are the tests in
 * `test/shopeeFees.test.ts`.
 *
 * ## What it is for, and what it is not for
 *
 * It **estimates**. `docs/shopee-settlement-import.md` sets out at length why
 * a payout cannot be *computed* from an order export: two of the seven fee
 * lines — SPayLater XTRA and Komisi AMS — depend on facts no order export
 * carries, and both sampled orders read `Metode Pembayaran: SPayLater` while
 * only one paid the instalment fee. The honest spread is 6,9%–12,0%.
 *
 * So an estimate is a **starting point somebody edits**, never a settlement in
 * its own right:
 *
 * - Where the uploaded file states Shopee's own payout, that figure wins and
 *   the estimate only says how the deduction breaks down. `reconcileEstimate`
 *   is what reconciles the two, and it never silently swallows a difference —
 *   what the rates cannot explain becomes its own named line.
 * - Where the file states no payout, the estimate is all there is, and the
 *   screen says so in as many words before anything is written.
 *
 * That is the same rule the owner set on 2026-09-20 — *"the payment pending is
 * not always deducted as 10%, the user should be the one adding the
 * deduction"*. What changes is only that the shop's own published rates now do
 * the typing, and a person corrects them.
 *
 * Pure: no React, no store. `test/shopeeFees.test.ts` is the spec.
 */
import type { FeeKind, SettlementFee } from "./marketplace.js";

/**
 * Biaya Administrasi, per Shopee product category, for a Star/Star+ seller
 * (article 15965).
 *
 * ⚠️ Not one shop rate. Laptop, Desktop, Monitor, Penyimpanan Data, Komponen
 * and Printer are 5,25%; **Aksesoris Desktop & Laptop — which is where a
 * charger lives — is 6,75%**, as are Keyboard & Mouse and Komponen Network. A
 * single hard-coded rate would silently mis-cost every accessory the shop
 * lists.
 */
export const ADMIN_PCT = {
  /** Laptop, Desktop, Monitor, Penyimpanan Data, Komponen, Printer. */
  LAPTOP: 5.25,
  /** Aksesoris Desktop & Laptop, Keyboard & Mouse, Komponen Network. */
  ACCESSORY: 6.75,
} as const;

export type ShopeeCategory = keyof typeof ADMIN_PCT;

/** Biaya Proses Pesanan: flat, per completed order (article 3489). */
export const ORDER_PROCESS_FEE = 1_250;

/** Promo XTRA: 4,5% of the base, capped at Rp60.000 per unit. */
export const PROMO_XTRA_PCT = 4.5;
export const PROMO_XTRA_CAP_PER_UNIT = 60_000;

/**
 * Premi (asuransi). Observed on both sampled orders, published nowhere read so
 * far — which is a reason to keep it a named constant rather than a magic
 * number, so the day it is confirmed or disproved there is one place to say so.
 */
export const PREMI_PCT = 0.5;

/**
 * Gratis Ongkir XTRA. Published at 1% capped Rp40.000 for Kategori A / Ukuran
 * Biasa; **observed at 0,5% uncapped**, three weeks apart, in the shop's
 * favour and unexplained (docs/shopee-fees.md, "Two anomalies worth money").
 * The observed rate is the default because it is what the shop is actually
 * charged; `PUBLISHED` is kept beside it so the day the anomaly ends the
 * change is one word.
 */
export const FREE_SHIPPING_PCT = { OBSERVED: 0.5, PUBLISHED: 1 } as const;
export const FREE_SHIPPING_CAP = 40_000;

/** SPayLater XTRA 0%, on the FINANCED amount — not on the list price. */
export const SPAYLATER_PCT = { NONE: 0, THREE_MONTHS: 2.5, SIX_MONTHS: 4 };
export type SpayLaterTenor = keyof typeof SPAYLATER_PCT;

/**
 * Komisi AMS: the affiliate's commission, only when an affiliate made the
 * sale, charged on the FINANCED amount with PPN on top. The seller balance
 * report of 1–21 Sep 2026 has five affiliate sales and every one is exactly
 * the rate × 1,11 — at 1% (81.197 on 7.315.000; 69.930 on 6.300.000) and at 2%
 * (110.600 on 4.982.000, and two more). The rate is the campaign's; 1% is
 * the one the switch assumes.
 */
export const AMS_PCT = 1;

/** PPN, on the lines Shopee charges it on top of — so far, Komisi AMS. */
export const PPN_PCT = 11;

/** Whole rupiah. Shopee rounds to the rupiah and so does every figure here. */
const rp = (n: number) => Math.round(n);
const pct = (base: number, percent: number) => rp((base * percent) / 100);

/** What is known about one sale, as far as an estimate can go. */
export interface ShopeeSaleFacts {
  /** Subtotal Pesanan — the list price of the goods. */
  readonly gross: number;
  /** How many units are on the order; the Promo XTRA cap is per unit. */
  readonly qty: number;
  /** Which admin band the goods fall in. */
  readonly category: ShopeeCategory;
  /**
   * Shopee's own voucher subsidy, when it is known.
   *
   * It matters for one reason: SPayLater and the affiliate commission are
   * charged on what the BUYER owes, which is the subtotal less this. Unknown
   * is treated as zero, which over-states both lines slightly — an estimate
   * that errs towards a bigger deduction is the safer direction, because it
   * under-states what the shop is owed.
   */
  readonly shopeeVoucher?: number;
  /** Did the buyer take 0% instalments, and over how long? */
  readonly spayLater?: SpayLaterTenor;
  /** Did an affiliate sell it? */
  readonly affiliate?: boolean;
  /** Use Shopee's published ongkir rate instead of the one the shop pays. */
  readonly publishedShipping?: boolean;
}

/** One estimated deduction, ready to become a `SettlementFee`. */
export interface EstimatedFee {
  readonly kind: FeeKind;
  readonly label: string;
  /**
   * Whole rupiah Shopee kept. Below zero only on `EXTRA_PAYMENT_LABEL`, which
   * is money Shopee ADDED — see `closeOnPayout`.
   */
  readonly amount: number;
  /**
   * How much of this the shop actually knows.
   *
   * `rate` is a published or observed rate applied to a known base — the four
   * lines every completed order pays. `conditional` is a line that only exists
   * because somebody said the sale had that property, which no export states.
   * `stated` is a line Shopee's own report printed.
   */
  readonly basis: "rate" | "conditional" | "stated";
  /**
   * The percentage the amount was worked out at, for a screen to print beside
   * it — "5,25%" is how somebody checks the line against the rate table.
   * Absent on a flat line and on a percentage its cap overrode.
   */
  readonly rate?: number;
}

/**
 * The fee lines the published rates predict for one sale.
 *
 * In the order Shopee's own order-detail screen lists them, which is the order
 * somebody checking the estimate against a screenshot will read them in.
 */
export function estimateShopeeFees(facts: ShopeeSaleFacts): EstimatedFee[] {
  const gross = Math.max(0, rp(facts.gross));
  const qty = Math.max(1, Math.floor(facts.qty));
  const voucher = Math.max(0, rp(facts.shopeeVoucher ?? 0));
  /*
   * What the BUYER owes, which is what Shopee finances and what an affiliate's
   * commission is charged on. The worked example in docs/shopee-fees.md turns
   * on this: 2,5% of the list price would be Rp192.500 and the order would not
   * reconcile; 2,5% of the financed 7.315.000 is Rp182.875, which it does.
   */
  const financed = Math.max(0, gross - voucher);
  const published = facts.publishedShipping === true;
  const shipping = freeShippingFee(gross, published);
  const shippingPct = published
    ? FREE_SHIPPING_PCT.PUBLISHED
    : FREE_SHIPPING_PCT.OBSERVED;
  const promo = promoXtraFee(gross, qty);
  const out: EstimatedFee[] = [
    {
      kind: "COMMISSION",
      label: "Biaya Administrasi",
      amount: pct(gross, ADMIN_PCT[facts.category]),
      basis: "rate",
      rate: ADMIN_PCT[facts.category],
    },
    {
      kind: "SERVICE",
      label: "Biaya Proses Pesanan",
      amount: ORDER_PROCESS_FEE,
      basis: "rate",
    },
    {
      kind: "SERVICE",
      label: "Biaya Gratis Ongkir XTRA",
      amount: shipping,
      basis: "rate",
      // A capped line is not that percentage of anything any more.
      ...(shipping === pct(gross, shippingPct) ? { rate: shippingPct } : {}),
    },
    {
      kind: "PROMOTION",
      label: "Biaya Promo XTRA",
      amount: promo,
      basis: "rate",
      ...(promo === pct(gross, PROMO_XTRA_PCT) ? { rate: PROMO_XTRA_PCT } : {}),
    },
  ];
  const tenor = facts.spayLater ?? "NONE";
  if (SPAYLATER_PCT[tenor] > 0) {
    out.push({
      kind: "SERVICE",
      label: "Biaya SPayLater XTRA 0%",
      amount: pct(financed, SPAYLATER_PCT[tenor]),
      basis: "conditional",
      rate: SPAYLATER_PCT[tenor],
    });
  }
  if (facts.affiliate === true) {
    out.push({
      kind: "PROMOTION",
      label: "Komisi AMS",
      // In whole hundredths, so 1% × 1,11 of 7.315.000 is exactly 81.196,5
      // and rounds to Shopee's 81.197 rather than wherever floating point
      // happens to land.
      amount: rp((financed * AMS_PCT * (100 + PPN_PCT)) / 10_000),
      basis: "conditional",
      rate: (AMS_PCT * (100 + PPN_PCT)) / 100,
    });
  }
  out.push({
    kind: "OTHER",
    label: "Premi",
    amount: pct(gross, PREMI_PCT),
    basis: "rate",
    rate: PREMI_PCT,
  });
  return out;
}

/**
 * Promo XTRA: 4,5% of the base, capped at Rp60.000 per unit.
 *
 * The cap binds on every laptop this shop sells — breakeven is Rp1.333.333 a
 * unit and the cheapest across 27 orders was Rp3.300.000 — but the rule is
 * implemented rather than the cap hard-coded, because a Rp500.000 charger pays
 * Rp22.500 and hard-coding would over-charge it by Rp37.500.
 */
export function promoXtraFee(base: number, qty: number): number {
  return Math.min(
    pct(Math.max(0, base), PROMO_XTRA_PCT),
    PROMO_XTRA_CAP_PER_UNIT * Math.max(1, Math.floor(qty)),
  );
}

/** Gratis Ongkir XTRA, at the observed half-rate unless told otherwise. */
export function freeShippingFee(base: number, published: boolean): number {
  const raw = pct(
    Math.max(0, base),
    published ? FREE_SHIPPING_PCT.PUBLISHED : FREE_SHIPPING_PCT.OBSERVED,
  );
  // The cap belongs to the published rate; the observed one has never been
  // seen to cap, which is the whole anomaly.
  return published ? Math.min(raw, FREE_SHIPPING_CAP) : raw;
}

/** What the rates say Shopee will pay out for this sale. */
export function estimatedPayout(facts: ShopeeSaleFacts): number {
  const deducted = estimateShopeeFees(facts).reduce((n, f) => n + f.amount, 0);
  return Math.max(0, rp(facts.gross) - deducted);
}

/** The cost of a sale as a percentage of its list price. */
export function effectiveCostPct(facts: ShopeeSaleFacts): number {
  const gross = Math.max(0, rp(facts.gross));
  if (gross === 0) return 0;
  return ((gross - estimatedPayout(facts)) / gross) * 100;
}

/**
 * What Shopee kept that no rule accounts for.
 *
 * > *"If there is discrepancies that are not mentioned in the rule just add
 * > like Biaya lainnya / additional payment."* — owner, 2026-09-21
 *
 * Measured against the seller balance report of 1–21 Sep 2026, this is almost
 * always a programme the order export cannot see: SPayLater XTRA, an
 * affiliate's commission, or the Ukuran Khusus ongkir band a 5 kg listing
 * falls into (docs/shopee-fees.md, "What the balance report settled").
 * Title case, as Shopee writes its own lines, because it sits among them.
 */
export const OTHER_FEES_LABEL = "Biaya Lainnya";

/**
 * The other direction: Shopee paid MORE than its own published fees leave
 * room for. A courier's compensation (Kompensasi Jasa Kirim) does this, and so does
 * a sale recorded at the till below the price Shopee sold it at.
 *
 * It is written as a line of its own with a NEGATIVE amount — money added to
 * the payout — so the lines still close exactly on what landed. A person
 * cannot start one (a new line's box in the deductions dialog stops at zero);
 * only this file writes one.
 */
export const EXTRA_PAYMENT_LABEL = "Pembayaran Tambahan";

export interface ReconciledFees {
  readonly fees: readonly EstimatedFee[];
  /**
   * What the lines could not explain. Positive means Shopee kept more than
   * they predict — `OTHER_FEES_LABEL`. Negative means it paid out more —
   * `EXTRA_PAYMENT_LABEL`.
   */
  readonly unexplained: number;
}

/**
 * Close a set of deduction lines on the payout Shopee actually made.
 *
 * The stated payout is the truth — it is the only figure anybody can check,
 * which is the rule `lib/marketplace.ts` has held since 2026-09-08. So the
 * lines' job is to say what the deduction was MADE OF, and anything they
 * cannot account for becomes a line of its own rather than being spread
 * silently over the lines they can.
 *
 * Spreading would be the tempting version and it would be wrong twice over: it
 * would make the admin fee read as something other than 5,25% of the subtotal,
 * and it would hide exactly the thing the rates exist to catch — an accessory
 * booked as a laptop, a lapsed programme, a unit charged at Ukuran Khusus.
 *
 * Afterwards `gross − Σ amounts` is exactly `payout`, which is what the
 * deductions dialog computes what landed from: a line left over would be a
 * received figure the dialog silently rewrites the first time somebody opens
 * it.
 */
export function closeOnPayout(
  fees: readonly EstimatedFee[],
  gross: number,
  payout: number,
): ReconciledFees {
  const deducted = fees.reduce((n, f) => n + f.amount, 0);
  const unexplained = Math.max(0, rp(gross)) - rp(payout) - deducted;
  if (unexplained === 0) return { fees, unexplained: 0 };
  return {
    fees: [
      ...fees,
      {
        kind: "OTHER",
        label: unexplained > 0 ? OTHER_FEES_LABEL : EXTRA_PAYMENT_LABEL,
        amount: unexplained,
        basis: "conditional",
      },
    ],
    unexplained,
  };
}

/** The published rates, closed on a payout Shopee has actually stated. */
export function reconcileEstimate(
  facts: ShopeeSaleFacts,
  statedPayout: number,
): ReconciledFees {
  return closeOnPayout(estimateShopeeFees(facts), facts.gross, statedPayout);
}

/**
 * A fee line a Shopee report printed, filed under the bucket it belongs to
 * (docs/shopee-settlement-import.md, "The mapping"). The name stays Shopee's.
 */
export function statedFee(label: string, amount: number): EstimatedFee {
  const key = label.toLowerCase();
  const kind: FeeKind = /administrasi/.test(key)
    ? "COMMISSION"
    : /promo|ams|komisi/.test(key)
      ? "PROMOTION"
      : /proses|ongkir|layanan|spaylater/.test(key)
        ? "SERVICE"
        : "OTHER";
  return { kind, label, amount, basis: "stated" };
}

/** An estimate as the settlement dialog's own fee rows. */
export function toSettlementFees(
  fees: readonly EstimatedFee[],
  newId: () => string,
): SettlementFee[] {
  return fees.map((f) => ({
    id: newId(),
    kind: f.kind,
    label: f.label,
    amount: f.amount,
  }));
}

/**
 * What looks wrong about a set of fee lines Shopee actually stated.
 *
 * *"Rates as a validator, not a calculator"* — docs/shopee-settlement-import.md.
 * Each of these catches a real, money-sized mistake the shop can act on, and
 * none of them changes a figure: they are sentences for a person to read.
 */
export function feeWarnings(
  facts: ShopeeSaleFacts,
  stated: readonly { readonly label?: string; readonly amount: number }[],
): string[] {
  const gross = Math.max(0, rp(facts.gross));
  if (gross === 0) return [];
  const find = (re: RegExp) =>
    stated.find((f) => re.test((f.label ?? "").toLowerCase()));
  const out: string[] = [];

  const admin = find(/administrasi|admin/);
  if (admin !== undefined) {
    const rate = (admin.amount / gross) * 100;
    const expected = ADMIN_PCT[facts.category];
    // Half a point of tolerance: Shopee rounds to the rupiah and so does this.
    if (Math.abs(rate - expected) > 0.5) {
      const other =
        facts.category === "LAPTOP" ? ADMIN_PCT.ACCESSORY : ADMIN_PCT.LAPTOP;
      out.push(
        Math.abs(rate - other) <= 0.5
          ? `Biaya Administrasi is ${rate.toFixed(2)}%, which is the other category's rate — this sale may be listed under the wrong Shopee category.`
          : `Biaya Administrasi is ${rate.toFixed(2)}%, not the expected ${expected}%.`,
      );
    }
  }
  if (find(/promo xtra/) === undefined) {
    out.push("No Promo XTRA line — the programme may have lapsed.");
  }
  const ongkir = find(/gratis ongkir/);
  if (ongkir !== undefined) {
    const rate = (ongkir.amount / gross) * 100;
    if (rate > 1.5) {
      out.push(
        `Gratis Ongkir XTRA is ${rate.toFixed(2)}% — that is the Ukuran Khusus band. Check the listing's declared weight (5 kg and over is the expensive band).`,
      );
    } else if (rate > 0.75) {
      out.push(
        "Gratis Ongkir XTRA is at the full published rate — the half-rate the shop has been paying has ended.",
      );
    }
  }
  return out;
}
