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
    // A line below zero is money ADDED to the payout, and it nets. Only the
    // Shopee upload writes one — `EXTRA_PAYMENT_LABEL`, when Shopee paid more
    // than its own fees leave room for — so that the lines close on what
    // landed. A person cannot start one: a new line's amount box stops at
    // zero, which is what keeps a mistyped minus from inflating what the shop
    // thinks it is owed (SettleModal). Until 2026-09-21 this clamped to zero
    // instead, and the one line that needed a sign read as nothing.
    byKind[f.kind] += f.amount;
    deducted += f.amount;
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
 * Prisma's `Settlement` (migration `20260913120000_store_on_postgres`), with
 * its fees in `SettlementFee` and its history in `SettlementLog`.
 *
 * **One settlement per PAYMENT** — `paymentId` and `orderId` are single
 * foreign keys. A payout covering five sales is five settlements written in
 * one commit, sharing `channel`, `at` and `staff`, and `payoutsOf` puts them
 * back together for the screen. Until 2026-09-19 a channel's payout was ONE
 * row whose two ids were the sales' ids joined with commas, which the browser
 * store accepted and Postgres refused (no `Payment` is called `p1,p2`) — so
 * on the real database a withdrawal covering two sales could not be recorded
 * at all.
 */
export interface Settlement {
  readonly id: string;
  /** The payment this settles — `SalePayment.id`. Exactly one. */
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

// ---------------------------------------------------------------------------
// One payout, several sales (owner brief 2026-09-19)
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` exactly — largest remainder.
 *
 * Each share is its proportional part floored, and the rupiah left over go to
 * the shares with the biggest remainders (ties to the earlier one). The shares
 * always add up to `total` exactly: any other rounding leaves a few rupiah
 * unaccounted for on every reconciliation afterwards, which is the kind of
 * error that costs an afternoon each time somebody notices it.
 *
 * In BigInt, because `total × weight` for a Rp500jt payout over a Rp300jt sale
 * is past 2^53 — floating point would floor the wrong way on a large payout
 * and hand out one rupiah too many. A negative `total` (a shortfall being
 * spread) works the same way. A weight that is not positive takes nothing, and
 * with no positive weight at all every share is zero.
 *
 * Lived in ReceivablesPage until 2026-09-19; it is the arithmetic the page and
 * the Shopee report import share, so it is here where a test can read it.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const t = BigInt(Math.round(total));
  const w = weights.map((x) =>
    Number.isFinite(x) && x > 0 ? BigInt(Math.round(x)) : 0n,
  );
  const sum = w.reduce((n, x) => n + x, 0n);
  if (sum <= 0n) return weights.map(() => 0);
  const floors: bigint[] = [];
  const remainders: bigint[] = [];
  for (const x of w) {
    const num = t * x;
    // BigInt division truncates toward zero; a floor needs one more step down
    // for a negative numerator that did not divide evenly.
    let q = num / sum;
    let r = num - q * sum;
    if (r < 0n) {
      q -= 1n;
      r += sum;
    }
    floors.push(q);
    remainders.push(r);
  }
  let left = t - floors.reduce((n, x) => n + x, 0n);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (left <= 0n) break;
    floors[i] = (floors[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return floors.map((x) => Number(x));
}

/** One payment a payout covers. */
export interface PayoutPart {
  readonly paymentId: string;
  readonly orderId: string;
  /** The payment's amount — what the customer paid the marketplace for it. */
  readonly gross: number;
}

/** One payment's settlement, worked out and not yet written. */
export interface SettlementDraft extends PayoutPart {
  readonly fees: SettlementFee[];
  readonly received: number;
  /** Present only when THIS sale's figures disagree with its fees. */
  readonly reason?: string;
}

/**
 * Split one payout into one settlement per payment it covers.
 *
 * > *"Pick which sales a payout covers"* — owner brief, 2026-09-19. The bank
 * > shows one transfer; the database wants one `Settlement` per `Payment`.
 *
 * Every fee line is spread over the sales in proportion to what each sale
 * was (`apportion`, largest remainder), so each sale carries its share of the
 * commission and of the bank charge under the same names the statement used.
 *
 * What landed is NOT spread the same way independently, and that is
 * deliberate. Two separate roundings — one for the fees, one for the received
 * figure — would leave a rupiah of "discrepancy" on some sales of a payout
 * whose total agrees exactly, and each of those would be an unexplained
 * difference nobody made. So each sale's received figure is its gross, less
 * its fees, plus its share of the payout's own discrepancy: a payout that
 * agrees splits into sales that each agree, and a payout Rp150.000 short
 * splits into sales whose shortfalls add up to Rp150.000.
 *
 * `feeId` names each sale's copy of each fee line — every `SettlementFee` row
 * is its own primary key, so the copies cannot share the line's id.
 *
 * The result does not depend on the order `parts` arrive in: the rupiah a
 * rounding hands out go by payment id, not by position. Postgres returns a
 * payout's settlements ordered by their own ids, and `isEvenSplit` compares
 * against a fresh split of them — which must come out the same as the split
 * that was recorded from the pending table's order.
 */
export function splitPayout(
  parts: readonly PayoutPart[],
  payout: {
    readonly fees: readonly SettlementFee[];
    readonly received: number;
    readonly reason?: string;
  },
  feeId: (line: SettlementFee, part: number) => string,
): SettlementDraft[] {
  // Work in payment-id order; `at[i]` is where part i sits in it.
  const canon = parts
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (parts[a]!.paymentId < parts[b]!.paymentId
          ? -1
          : parts[a]!.paymentId > parts[b]!.paymentId
            ? 1
            : 0) || a - b,
    );
  const at = new Array<number>(parts.length);
  canon.forEach((i, pos) => {
    at[i] = pos;
  });
  const weights = canon.map((i) => parts[i]!.gross);
  const gross = weights.reduce((n, w) => n + Math.max(0, w), 0);
  // Signed, like `settlementTotals`: an addition spreads the same way a fee
  // does, and `apportion` splits a negative total exactly.
  const shares = payout.fees.map((f) => apportion(f.amount, weights));
  const discrepancy = apportion(
    settlementTotals({ gross, fees: payout.fees, received: payout.received })
      .discrepancy,
    weights,
  );
  const received = weights.map(
    (w, pos) =>
      w -
      shares.reduce((n, s) => n + (s[pos] ?? 0), 0) +
      (discrepancy[pos] ?? 0),
  );
  liftNegatives(received);
  return parts.map((p, i) => {
    const pos = at[i] ?? 0;
    const fees = payout.fees.map((f, k) => ({
      id: feeId(f, i),
      kind: f.kind,
      ...(f.label === undefined ? {} : { label: f.label }),
      amount: shares[k]?.[pos] ?? 0,
    }));
    const own = received[pos] ?? 0;
    const agrees = !settlementTotals({ gross: p.gross, fees, received: own })
      .needsReason;
    return {
      paymentId: p.paymentId,
      orderId: p.orderId,
      gross: p.gross,
      fees,
      received: own,
      ...(agrees || !payout.reason ? {} : { reason: payout.reason }),
    };
  });
}

/**
 * Nothing lands as less than nothing. When almost nothing arrived, rounding
 * can put a sale a rupiah or two below zero (and `Settlement.received` has a
 * CHECK against it); the deficit is taken from the largest share instead, so
 * the total is still exactly what landed.
 */
function liftNegatives(values: number[]): void {
  for (let i = 0; i < values.length; i++) {
    let deficit = -(values[i] ?? 0);
    if (deficit <= 0) continue;
    values[i] = 0;
    while (deficit > 0) {
      let top = -1;
      for (let j = 0; j < values.length; j++) {
        if (top < 0 || (values[j] ?? 0) > (values[top] ?? 0)) top = j;
      }
      const room = top < 0 ? 0 : (values[top] ?? 0);
      if (room <= 0) break;
      const take = Math.min(room, deficit);
      values[top] = room - take;
      deficit -= take;
    }
  }
}

/** Two fee lines are "the same line" when they have the same kind and name. */
const feeKey = (f: SettlementFee) =>
  `${f.kind}|${(f.label ?? "").trim().toLowerCase()}`;

/**
 * Fee lines summed across several settlements, by kind and name — what the
 * statement showed for the whole payout. Each merged line keeps the id of its
 * first member, so a dialog editing it can be traced back.
 */
export function mergeFees(
  settlements: readonly { readonly fees: readonly SettlementFee[] }[],
): SettlementFee[] {
  const by = new Map<string, SettlementFee>();
  for (const s of settlements) {
    for (const f of s.fees) {
      const k = feeKey(f);
      const cur = by.get(k);
      by.set(
        k,
        cur === undefined
          ? {
              id: f.id,
              kind: f.kind,
              ...(f.label === undefined ? {} : { label: f.label }),
              amount: f.amount,
            }
          : { ...cur, amount: cur.amount + f.amount },
      );
    }
  }
  return [...by.values()];
}

/**
 * One payout as the shop saw it: the settlements written together.
 *
 * Recognised by what they share — channel, the instant, the person — rather
 * than by an id encoding the group, because a grouping hidden in an id is a
 * link nothing enforces. Settlements recorded in one press share `at` to the
 * millisecond, and two presses by one person on one channel in the same
 * millisecond do not happen.
 */
export interface Payout<S extends Settlement = Settlement> {
  readonly key: string;
  readonly channel: string;
  readonly at: string;
  readonly staff: string;
  readonly settlements: readonly S[];
  readonly gross: number;
  readonly received: number;
  /** The fee lines of the whole payout — see `mergeFees`. */
  readonly fees: readonly SettlementFee[];
  /** Every distinct reason its sales carry. */
  readonly reasons: readonly string[];
}

/** Settlements back into payouts, newest first. */
export function payoutsOf<S extends Settlement>(
  settlements: readonly S[],
): Payout<S>[] {
  const by = new Map<string, S[]>();
  for (const s of settlements) {
    const key = `${s.channel}|${s.at}|${s.staff}`;
    by.set(key, [...(by.get(key) ?? []), s]);
  }
  return [...by.entries()]
    .map(([key, list]) => ({
      key,
      channel: list[0]!.channel,
      at: list[0]!.at,
      staff: list[0]!.staff,
      settlements: list,
      gross: list.reduce((n, s) => n + s.gross, 0),
      received: list.reduce((n, s) => n + s.received, 0),
      fees: mergeFees(list),
      reasons: [
        ...new Set(
          list.map((s) => s.reason?.trim() ?? "").filter((r) => r !== ""),
        ),
      ],
    }))
    .sort((a, b) =>
      a.at === b.at ? a.key.localeCompare(b.key) : a.at < b.at ? 1 : -1,
    );
}

const partsOf = (p: Payout): PayoutPart[] =>
  p.settlements.map((s) => ({
    paymentId: s.paymentId,
    orderId: s.orderId,
    gross: s.gross,
  }));

/**
 * Is this payout still exactly the split `splitPayout` makes of its totals?
 *
 * True for a payout recorded as one bank figure and never corrected sale by
 * sale — and only then is it safe to correct AS one figure, because
 * re-spreading it reproduces what is there. A payout imported from a report
 * carries each order's own payout, and re-spreading that in proportion to the
 * sales would overwrite figures the report stated; it is corrected sale by
 * sale instead.
 */
export function isEvenSplit(p: Payout): boolean {
  if (p.settlements.length <= 1) return true;
  const drafts = splitPayout(
    partsOf(p),
    { fees: p.fees, received: p.received },
    () => "",
  );
  return drafts.every((d, i) => {
    const s = p.settlements[i];
    if (s === undefined || d.received !== s.received) return false;
    const own = mergeFees([s]);
    return (
      own.length === d.fees.length &&
      d.fees.every(
        (f) => own.find((o) => feeKey(o) === feeKey(f))?.amount === f.amount,
      )
    );
  });
}

/**
 * A corrected payout, spread back over its sales the way it was spread when
 * it was recorded (`splitPayout`).
 *
 * Each sale keeps the ids of the fee lines it already had — a correction is an
 * edit of those rows, not a new set of rows beside soft-removed ones — and a
 * line added in the correction gets a new id per sale. For a payout of ONE
 * sale this is simply that sale's figures, which is how a single sale of a
 * larger payout is corrected too.
 */
export function respreadPayout<S extends Settlement>(
  p: Payout<S>,
  amended: {
    readonly fees: readonly SettlementFee[];
    readonly received: number;
    readonly reason?: string;
  },
  newFeeId: () => string,
): S[] {
  const keyOfLine = new Map(p.fees.map((f) => [f.id, feeKey(f)]));
  const drafts = splitPayout(partsOf(p), amended, (line, i) => {
    const key = keyOfLine.get(line.id);
    const mine =
      key === undefined
        ? undefined
        : p.settlements[i]?.fees.find((f) => feeKey(f) === key);
    return mine?.id ?? newFeeId();
  });
  return p.settlements.map((s, i) => {
    const d = drafts[i]!;
    return { ...s, fees: d.fees, received: d.received, reason: d.reason };
  });
}

/**
 * A note added to a payment's own note, which may already say something
 * ("Shopee PayLater") — added, never overwriting it.
 */
export function joinNote(existing: string | undefined, note: string): string {
  const before = existing?.trim() ?? "";
  const add = note.trim();
  if (add === "" || before.includes(add)) return before;
  return before === "" ? add : `${before} · ${add}`;
}
