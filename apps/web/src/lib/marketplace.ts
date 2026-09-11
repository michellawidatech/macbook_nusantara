/**
 * Marketplace money: what was sold, what the platform kept, and what landed.
 *
 * ## The owner's ask (2026-09-08)
 *
 * > *"For orders from tokopedia and shopee … we will input in new transaction,
 * > then it will have fixed fee from the marketplace (let's say 10%), then
 * > often times there're additional adjustment like bank transfer fee. But the
 * > existing system don't keep track of which fee is which and what the
 * > adjustment is for."*
 *
 * The shop already knew a Shopee sale was unsettled — `Order.settled` and
 * `holdsFunds` have said so since 2026-08-26 — and it knew what finally
 * arrived, because `Order.netReceived` recorded it. What it could not say was
 * **why the two differ**. A sale of Rp10.000.000 that pays out Rp8.850.000 has
 * a commission, a service fee and very often a bank charge inside that
 * Rp1.150.000, and one netted figure loses all three. A month later nobody can
 * answer "are Shopee's fees going up?" or "did they charge us twice?".
 *
 * So a withdrawal is a document now: the gross, the fees ITEMISED, what
 * actually landed, and — when those two disagree — a reason, because the
 * disagreement is the interesting part.
 *
 * ## The arithmetic, and which number is the truth
 *
 * ```
 *   gross            what the customer paid the marketplace
 * − commission       the platform's cut, by its own published rate
 * − other fees       service, bank transfer, a promotion the shop opted into
 * ─────────────
 * = expected         what the shop should receive
 *
 *   received         what the bank statement actually says   ← the truth
 * − expected
 * ─────────────
 * = discrepancy      what nobody has explained yet
 * ```
 *
 * `received` is the figure staff can overwrite and the one everything
 * downstream believes, because it is the only one anybody can check against a
 * statement. `expected` is a prediction; a prediction that disagrees with the
 * bank is wrong by definition. The discrepancy is not hidden and not silently
 * absorbed into a fee — it is shown, and it asks for a sentence.
 *
 * Pure: no React, no store. `test/marketplace.test.ts` is the spec.
 */

/**
 * What kind of deduction this is.
 *
 * Four, and the split is the whole point of the feature — the owner's
 * complaint was that the system *"don't keep track of which fee is which"*.
 * `COMMISSION` is the platform's published cut and is the one the rule
 * computes; the rest are typed, because they are the ones that vary.
 */
export type FeeKind =
  /** The platform's percentage. Computed by the rule, overridable. */
  | "COMMISSION"
  /** A per-order service or handling charge. */
  | "SERVICE"
  /** What the bank took to move the money. The owner's own example. */
  | "TRANSFER"
  /** A campaign, a voucher the shop funded, a shipping subsidy. */
  | "PROMOTION"
  | "OTHER";

export const FEE_KINDS: readonly {
  readonly value: FeeKind;
  readonly label: string;
  readonly guide: string;
}[] = [
  {
    value: "COMMISSION",
    label: "Marketplace commission",
    guide: "The platform's published percentage of the sale.",
  },
  {
    value: "SERVICE",
    label: "Service fee",
    guide: "A per-order handling or processing charge.",
  },
  {
    value: "TRANSFER",
    label: "Bank transfer fee",
    guide: "What the bank took to move the money into the shop's account.",
  },
  {
    value: "PROMOTION",
    label: "Promotion or voucher",
    guide: "A campaign or voucher the shop funded out of this sale.",
  },
  { value: "OTHER", label: "Other", guide: "Anything else deducted." },
];

/** One deduction on one withdrawal. */
export interface SettlementFee {
  readonly id: string;
  readonly kind: FeeKind;
  /** What it is called on the platform's own statement. */
  readonly label?: string;
  readonly amount: number;
}

/**
 * The commission a channel charges, as a percentage.
 *
 * Per channel because they genuinely differ and the shop knows its own rates.
 * A channel with no entry answers `DEFAULT_COMMISSION_PCT`, which is the
 * owner's *"let's say 10%"* — a starting point staff correct, not a claim
 * about any platform.
 *
 * ⚠️ Mock-only, on `AppSettings.marketplaceFees`. The `AppSetting` table is
 * key/value so a per-channel rate needs no migration, but the keys do not
 * exist there yet.
 */
export const DEFAULT_COMMISSION_PCT = 10;

export function commissionPctOf(
  channel: string,
  rates: Readonly<Record<string, number>> | undefined,
): number {
  const rate = rates?.[channel];
  return rate === undefined || !Number.isFinite(rate)
    ? DEFAULT_COMMISSION_PCT
    : rate;
}

/**
 * The commission the rule produces for a gross amount.
 *
 * Rounded to whole rupiah — the money column is whole rupiah everywhere — and
 * rounded DOWN, so a rounding error never makes the shop's expectation of
 * itself higher than the platform's own arithmetic. Predicting a fee larger
 * than the one charged produces a positive discrepancy, which reads as "they
 * took less than we thought"; the other direction reads as a shortfall, and a
 * shortfall that is really a rounding artefact is a false alarm somebody has
 * to investigate.
 */
export function commissionOn(gross: number, pct: number): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.floor((gross * Math.max(0, pct)) / 100);
}

/** What one withdrawal says. */
export interface SettlementInput {
  readonly gross: number;
  readonly fees: readonly SettlementFee[];
  /**
   * What the bank statement says landed.
   *
   * Optional while somebody is still typing; `settlementTotals` reads a
   * missing value as "the expectation", so the form opens with the computed
   * figure already in the box and a zero discrepancy.
   */
  readonly received?: number;
}

export interface SettlementTotals {
  readonly gross: number;
  /** Σ fees. */
  readonly deducted: number;
  /** gross − deducted. What the shop should receive. */
  readonly expected: number;
  /** What actually landed. Defaults to `expected`. */
  readonly received: number;
  /**
   * received − expected.
   *
   * Negative means less arrived than the fees explain — a fee nobody recorded.
   * Positive means more arrived — a fee over-estimated, or a refund. Zero
   * means the statement and the arithmetic agree, which is the common case and
   * the one that needs no sentence.
   */
  readonly discrepancy: number;
  /** Does this need a reason before it can be filed? */
  readonly needsReason: boolean;
  /** Fees by kind, so a card can show what actually varies. */
  readonly byKind: Readonly<Record<FeeKind, number>>;
}

/** The default sentence, so the common case is one click (owner ask). */
export const DEFAULT_DISCREPANCY_REASON = "Marketplace fee adjustment";

export function settlementTotals(input: SettlementInput): SettlementTotals {
  const gross = Math.max(0, input.gross);
  const byKind: Record<FeeKind, number> = {
    COMMISSION: 0,
    SERVICE: 0,
    TRANSFER: 0,
    PROMOTION: 0,
    OTHER: 0,
  };
  let deducted = 0;
  for (const f of input.fees) {
    // Negative fees are refused rather than netted: money coming BACK is not a
    // fee, and letting one in would let a mistyped minus quietly inflate what
    // the shop thinks it is owed.
    const amount = Math.max(0, f.amount);
    byKind[f.kind] += amount;
    deducted += amount;
  }
  const expected = gross - deducted;
  const received = input.received ?? expected;
  return {
    gross,
    deducted,
    expected,
    received,
    discrepancy: received - expected,
    needsReason: received !== expected,
    byKind,
  };
}

/**
 * The fees a fresh withdrawal starts with: the commission, and nothing else.
 *
 * One line rather than a blank form, because the commission is the one
 * deduction that is on every payout and the one the shop can compute in
 * advance. Everything else — the bank charge, the campaign — is typed, because
 * those are the ones that are *"often times"* rather than always.
 */
export function seedFees(
  gross: number,
  channel: string,
  rates: Readonly<Record<string, number>> | undefined,
  id: string,
): SettlementFee[] {
  const pct = commissionPctOf(channel, rates);
  return [
    {
      id,
      kind: "COMMISSION",
      label: `${pct}%`,
      amount: commissionOn(gross, pct),
    },
  ];
}

/**
 * A recorded withdrawal — one marketplace payment turned into money.
 *
 * ⚠️ Mock-only. Prisma's `Payment` can carry the net figure and the date, but
 * nothing there can hold the itemised fees; that is a `PaymentFee` table on
 * the same footing as `OrderFee`, plus an owner decision.
 */
export interface Settlement {
  readonly id: string;
  /** The payment this settles — `SalePayment.id`. */
  readonly paymentId: string;
  readonly orderId: string;
  readonly channel: string;
  readonly gross: number;
  readonly fees: readonly SettlementFee[];
  readonly received: number;
  /** Why `received` differs from the arithmetic. Required when it does. */
  readonly reason?: string;
  readonly at: string;
  readonly staff: string;
}

/** One change to a settlement, kept forever. *"It is editable and logged."* */
export interface SettlementLogEntry {
  readonly id: string;
  readonly settlementId: string;
  readonly at: string;
  readonly staff: string;
  readonly action: "RECORDED" | "AMENDED" | "REOPENED";
  readonly before?: { readonly received: number; readonly deducted: number };
  readonly after?: { readonly received: number; readonly deducted: number };
  readonly reason?: string;
}

/** What is still owed to the shop by one channel, and by all of them. */
export interface PendingByChannel {
  readonly channel: string;
  readonly gross: number;
  readonly count: number;
  /** What would land if every fee behaved as the rule predicts. */
  readonly expected: number;
}

/**
 * Pending money, grouped by the channel holding it.
 *
 * Per channel because withdrawing is a per-channel errand: somebody signs in
 * to Shopee's dashboard and presses a button there, then does the same on
 * Tokopedia. A single "Rp23.400.000 pending" figure is not something anybody
 * can act on.
 */
export function pendingByChannel(
  payments: readonly {
    readonly amount: number;
    readonly state: string;
    readonly channel?: string;
  }[],
  rates: Readonly<Record<string, number>> | undefined,
): PendingByChannel[] {
  const by = new Map<string, { gross: number; count: number }>();
  for (const p of payments) {
    if (p.state !== "PENDING") continue;
    const channel = p.channel ?? "UNKNOWN";
    const cur = by.get(channel) ?? { gross: 0, count: 0 };
    by.set(channel, { gross: cur.gross + p.amount, count: cur.count + 1 });
  }
  return [...by.entries()]
    .map(([channel, { gross, count }]) => ({
      channel,
      gross,
      count,
      expected: gross - commissionOn(gross, commissionPctOf(channel, rates)),
    }))
    .sort((a, b) => b.gross - a.gross);
}
