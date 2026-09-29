/**
 * How the customer is paying, as the till asks it — and the payments a sale
 * records from the answer.
 *
 * ## The owner's revision (2026-09-19)
 *
 * > *"The payment method in new transaction page should be way simpler.
 * > Payment method is just these: transfer, cash, shopee, tokopedia. The user
 * > can select multiple. If selecting multiple, it will be listed below
 * > (payment method, split amount, actual paid) and the user needs to input
 * > the amounts."*
 *
 * It replaces a row of every sale-enabled method in Settings plus a *Pay in
 * parts* grid with a state picker per row (Received / With a marketplace /
 * Owed). The two questions that grid asked are still asked, just as numbers:
 *
 * - **Split amount** — how much of the bill goes through this method. With one
 *   method it is the whole total. With several, every row but the LAST is
 *   typed and the last takes the rest, so the split always adds up to the bill
 *   and nobody does the subtraction.
 * - **Actual paid** — what the customer has actually handed over on that part,
 *   the whole split unless it is lowered. What is left of a split is a debt the
 *   customer owes (piutang), which is how a partial payment is recorded.
 *
 * ## The owner's revision (2026-09-21)
 *
 * > *"The payment method that have the actual paid is only cash / transfer,
 * > shopee and tokopedia do not have that, and the default column should
 * > actually be blank instead of prefilled."*
 *
 * Two changes, both about the Actual paid column and neither about the split:
 *
 * - **Only cash and a transfer have one** (`canPayInPart`). Shopee and
 *   Tokopedia are paid in full through the marketplace's own checkout before
 *   the order reaches the shop; the row shows the amount and no box.
 * - **The box starts EMPTY**, with the split as its placeholder. Empty still
 *   means "the whole split" — that is what `paid` being absent has always
 *   meant — so nothing about an ordinary sale changes; what changes is that
 *   somebody recording a part payment types a number into an empty box instead
 *   of selecting and deleting one first.
 *
 * ## What it writes
 *
 * Still the payment LIST of 2026-09-08 (`lib/salePayments.ts`) — nothing
 * downstream changes. Per part:
 *
 * - what was paid: SETTLED for cash or a transfer; PENDING for Shopee and
 *   Tokopedia, because the customer paid the marketplace and the marketplace
 *   holds it until a payout (the payment carries `channel`);
 * - what is left: DUE — the customer owes it — with the due date, if one was
 *   given.
 *
 * Shopee and Tokopedia are not `PaymentMethod` codes: both are the
 * `MARKETPLACE` code with the marketplace named on the payment, exactly as a
 * marketplace sale has been written since 2026-09-08.
 *
 * ## The payment reference
 *
 * The owner's brief: *"Add required field for Payment references on
 * Shopee/tokopedia/tiktok."* It is the marketplace's order number, and it is
 * what a marketplace's income report names each payout by — so it is what
 * marks a sale received from a report.
 *
 * **One per marketplace part** (owner revision 2026-09-21): *"Shopee,
 * tokopedia → have the amount & reference number (1 for shopee 1 for
 * tokopedia) … if the user choose 1 shopee 1 tokopedia, then have 2 reference
 * number"*. A sale half through Shopee and half through Tokopedia is two
 * orders on two platforms, each with its own number, and each payout arrives
 * under its own — so the number lives on the part (`TillPart.ref`) and is
 * written on that part's payment (`Payment.ref`). It used to be one number
 * for the whole sale, written on every payment, which could not say which
 * platform's order it was.
 *
 * The sale still owes a number of its own in one case: its CHANNEL is a
 * marketplace and nothing is paid through one — a TikTok sale, which has no
 * chip, or a Shopee sale somebody took in cash (`saleRefNeeded`).
 *
 * ## A debt names its debtor (owner ask 2026-09-24)
 *
 * > *"When we record a new transaction and the user owe something, they need
 * > to add names or phone number (either is fine)."*
 *
 * A sale that leaves something owed (`owed > 0` — an Actual paid below its
 * split) cannot be recorded against nobody: Receivable would list a debt with
 * no one to telephone, and "Walk-in customers" is a heading, not a person.
 * `tillProblems` reports `NO_DEBTOR` until the sale names a customer with a
 * name OR a phone number (`lib/customers.ts` — either is enough). A sale paid
 * in full is still recordable without anyone, which is nine sales in ten.
 *
 * Pure: no React, no store. `test/tillPayments.test.ts` is the spec.
 */
import { holdsFunds, type SaleSource } from "./channels.js";
import { hasContact, type CustomerContact } from "./customers.js";
import type { SalePayment } from "./salePayments.js";

/** One of the four chips. */
export type TillMethod = "TRANSFER" | "TUNAI" | "SHOPEE" | "TOKOPEDIA";

export interface TillMethodDef {
  readonly key: TillMethod;
  /** The `PaymentMethod` code a payment through it is written with. */
  readonly code: string;
  /** The marketplace holding the money, for the two that are one. */
  readonly channel?: SaleSource;
}

/** The chips, in the order the till shows them (the owner's order). */
export const TILL_METHODS: readonly TillMethodDef[] = [
  { key: "TRANSFER", code: "TRANSFER" },
  { key: "TUNAI", code: "TUNAI" },
  { key: "SHOPEE", code: "MARKETPLACE", channel: "SHOPEE" },
  { key: "TOKOPEDIA", code: "MARKETPLACE", channel: "TOKOPEDIA" },
];

const DEF = new Map(TILL_METHODS.map((m) => [m.key, m]));

/**
 * Which of the four chips a recorded payment was made through.
 *
 * `undefined` for anything else — a QRIS or card payment from before the four
 * were fixed, or a TikTok part. The payment editor keeps such a row on its own
 * label rather than rewriting it into one of the four, because the method is
 * what `lib/accounts.ts` sorts the money by and a silent change of it moves
 * cash into the bank.
 */
export function tillMethodOfPayment(payment: {
  readonly method: string;
  readonly channel?: string;
}): TillMethod | undefined {
  if (payment.method === "TRANSFER") return "TRANSFER";
  if (payment.method === "TUNAI") return "TUNAI";
  if (payment.channel === "SHOPEE") return "SHOPEE";
  if (payment.channel === "TOKOPEDIA") return "TOKOPEDIA";
  return undefined;
}

export function tillMethod(key: TillMethod): TillMethodDef {
  return DEF.get(key)!;
}

/** Does a marketplace hold what is paid through this method? */
export function isMarketplaceMethod(key: TillMethod): boolean {
  return tillMethod(key).channel !== undefined;
}

/**
 * Can this part be paid in part — does it have an "actual paid" at all?
 *
 * Only cash and a transfer (owner revision 2026-09-21: *"the payment method
 * that have the actual paid is only cash / transfer, shopee and tokopedia do
 * not have that"*). A marketplace checkout is all-or-nothing by construction:
 * the customer paid Shopee the whole of that part before the order reached the
 * shop, so there is nothing for anyone at the counter to hand over less of,
 * and a box that could say otherwise would only ever record a mistake.
 *
 * What it means downstream: a marketplace part is always paid in full, so it
 * writes one PENDING payment and never a DUE one. A customer debt on a sale is
 * always a debt of cash or a transfer, which is exactly what Receivables' "owed
 * by customers" table is for.
 */
export function canPayInPart(key: TillMethod): boolean {
  return !isMarketplaceMethod(key);
}

/**
 * One chip that is picked, and what was typed for it — in the order the chips
 * were picked, so the one added last is the one that takes the rest.
 */
export interface TillPart {
  readonly method: TillMethod;
  /** The split typed for it. Ignored on the last part, which takes the rest. */
  readonly split?: number;
  /**
   * What was actually paid on it. Absent: the whole split.
   *
   * Absent is the ordinary case and it is what the box shows (owner revision
   * 2026-09-21: *"the default column should actually be blank instead of
   * prefilled"*) — an empty box with the split as its placeholder, rather than
   * a figure somebody has to select and delete before typing the one they mean.
   * Ignored altogether on a marketplace part; see `canPayInPart`.
   */
  readonly paid?: number;
  /**
   * The marketplace's order number, on a Shopee or Tokopedia part — where a
   * cash part has its Actual paid (owner revision 2026-09-21). Ignored on
   * cash and a transfer. See the header.
   */
  readonly ref?: string;
}

/** A part as the screen shows it, with the arithmetic done. */
export interface TillRow {
  readonly method: TillMethod;
  readonly split: number;
  readonly paid: number;
  /** What the customer still owes on this part. */
  readonly owed: number;
  /** False on the last row (it takes the rest) and on a lone row (the total). */
  readonly splitEditable: boolean;
  /** False for Shopee and Tokopedia, which are paid in full. `canPayInPart`. */
  readonly paidEditable: boolean;
}

export interface TillRows {
  readonly rows: readonly TillRow[];
  /** How far the typed splits run past the total; 0 when they fit. */
  readonly splitOver: number;
  /** Σ paid — what the customer has handed over, whoever holds it now. */
  readonly paid: number;
  /** Σ owed — the customer's debt on this sale. */
  readonly owed: number;
}

const whole = (n: number | undefined) =>
  n === undefined || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(n));

/**
 * The parts with their arithmetic done: each split, what was paid on it and
 * what is still owed. The last part takes whatever the others leave of the
 * total; a paid figure above its split is held AT the split here, and
 * reported by `tillProblems` rather than silently becoming change.
 */
export function tillRows(total: number, parts: readonly TillPart[]): TillRows {
  const bill = whole(total);
  const typed = parts.slice(0, -1).map((p) => whole(p.split));
  const typedSum = typed.reduce((t, n) => t + n, 0);
  const splitOver = parts.length > 1 ? Math.max(0, typedSum - bill) : 0;
  const rows = parts.map((p, i): TillRow => {
    const last = i === parts.length - 1;
    const split = last ? Math.max(0, bill - typedSum) : typed[i]!;
    const paidEditable = canPayInPart(p.method);
    // A marketplace part ignores whatever is on the part and is paid in full:
    // the customer paid the marketplace before the order reached the shop.
    const paid = !paidEditable
      ? split
      : Math.min(p.paid === undefined ? split : whole(p.paid), split);
    return {
      method: p.method,
      split,
      paid,
      owed: split - paid,
      splitEditable: !last,
      paidEditable,
    };
  });
  return {
    rows,
    splitOver,
    paid: rows.reduce((t, r) => t + r.paid, 0),
    owed: rows.reduce((t, r) => t + r.owed, 0),
  };
}

/** Is a payment reference owed anywhere on this sale? See the header. */
export function needsPaymentRef(
  source: string,
  parts: readonly TillPart[],
): boolean {
  return holdsFunds(source) || parts.some((p) => isMarketplaceMethod(p.method));
}

/**
 * Does the SALE owe a number that no part can carry? Its channel is a
 * marketplace and nothing is paid through one — TikTok, which has no chip, or
 * a Shopee sale taken in cash. Otherwise each marketplace part carries its own.
 */
export function saleRefNeeded(
  source: string,
  parts: readonly TillPart[],
): boolean {
  return (
    holdsFunds(source) && !parts.some((p) => isMarketplaceMethod(p.method))
  );
}

/** A marketplace part with no order number yet — its box goes red. */
export function refMissing(part: TillPart): boolean {
  return isMarketplaceMethod(part.method) && (part.ref ?? "").trim() === "";
}

/** Why a sale's payment answer cannot be recorded yet. */
export type TillProblem =
  /** No chip picked, on a bill that has something to pay. */
  | "NO_METHOD"
  /** The typed splits add up to more than the bill. */
  | "SPLIT_OVER"
  /** A part says more was paid than its split. */
  | "PAID_OVER"
  /** A marketplace part, or a marketplace sale, without its order number. */
  | "NO_REF"
  /** Something is owed and the sale names nobody with a name or a number. */
  | "NO_DEBTOR";

export function tillProblems(input: {
  readonly total: number;
  readonly source: string;
  readonly parts: readonly TillPart[];
  /** The sale's own number — consulted only when `saleRefNeeded`. */
  readonly ref: string;
  /**
   * The customer on the sale, if one is picked — consulted only when
   * something is owed. Absent or null is a walk-in.
   */
  readonly debtor?: CustomerContact | null;
}): TillProblem[] {
  const out: TillProblem[] = [];
  const bill = whole(input.total);
  if (bill > 0 && input.parts.length === 0) out.push("NO_METHOD");
  const { rows, splitOver, owed } = tillRows(bill, input.parts);
  if (splitOver > 0) out.push("SPLIT_OVER");
  if (
    input.parts.some(
      (p, i) =>
        canPayInPart(p.method) &&
        p.paid !== undefined &&
        whole(p.paid) > rows[i]!.split,
    )
  ) {
    out.push("PAID_OVER");
  }
  // A part's own number, or else the sale's — the same fallback
  // `tillPayments` writes with.
  const saleRef = input.ref.trim();
  if (
    (saleRef === "" && input.parts.some(refMissing)) ||
    (saleRefNeeded(input.source, input.parts) && saleRef === "")
  ) {
    out.push("NO_REF");
  }
  // Last, because it is the one problem not on the payment table: the box
  // that answers it is the customer's, and the toast names the first problem.
  if (owed > 0 && !(input.debtor && hasContact(input.debtor))) {
    out.push("NO_DEBTOR");
  }
  return out;
}

/**
 * The payments the sale records. A part paid in full is one payment; a part
 * paid in part is two — what was paid, and what is still owed.
 */
export function tillPayments(input: {
  readonly total: number;
  readonly parts: readonly TillPart[];
  /** When the sale is recorded. */
  readonly at: string;
  /** When the customer promised to pay what is owed, if they said. */
  readonly dueAt?: string;
  /**
   * The sale's own number (see `saleRefNeeded`). A marketplace part carries
   * its own, and this is only its fallback.
   */
  readonly ref?: string;
  readonly newId: () => string;
}): SalePayment[] {
  const saleRef = input.ref?.trim();
  const out: SalePayment[] = [];
  tillRows(input.total, input.parts).rows.forEach((row, i) => {
    const def = tillMethod(row.method);
    const own = def.channel ? input.parts[i]?.ref?.trim() : undefined;
    const ref = own || saleRef;
    const shared = {
      method: def.code,
      at: input.at,
      ...(ref ? { ref } : {}),
    };
    if (row.paid > 0) {
      out.push({
        id: input.newId(),
        ...shared,
        amount: row.paid,
        ...(def.channel
          ? { state: "PENDING" as const, channel: def.channel }
          : { state: "SETTLED" as const }),
      });
    }
    if (row.owed > 0) {
      out.push({
        id: input.newId(),
        ...shared,
        amount: row.owed,
        state: "DUE",
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      });
    }
  });
  return out;
}

/**
 * The chips a channel implies, when it implies any.
 *
 * A Shopee sale is paid through Shopee and a Tokopedia sale through Tokopedia,
 * so picking either channel picks its chip. Leaving a marketplace for an
 * ordinary channel puts back cash — but only if the payment was still that
 * marketplace's own chip, so a split somebody arranged by hand is left alone.
 * TikTok has no chip (owner, 2026-09-19: "only the four") and changes nothing.
 */
export function partsForChannel(
  next: string,
  previous: string,
  parts: readonly TillPart[],
): readonly TillPart[] {
  if (next === "SHOPEE" || next === "TOKOPEDIA") {
    // The number already typed against that platform survives the switch.
    const ref = parts.find((p) => p.method === next)?.ref;
    return [{ method: next, ...(ref ? { ref } : {}) }];
  }
  const onlyPrevious =
    parts.length === 1 && (parts[0]!.method as string) === previous;
  if (!holdsFunds(next) && holdsFunds(previous) && onlyPrevious) {
    return [{ method: "TUNAI" }];
  }
  return parts;
}

/**
 * Pick or unpick a chip. A newly picked one goes last and takes the rest.
 *
 * The part that WAS last keeps the amount it was showing: adding Transfer to a
 * Cash sale of Rp10jt leaves Cash at Rp10jt and Transfer at nothing, and
 * typing Rp5jt into Cash hands Transfer the other five. Letting the old last
 * part fall back to a typed split it never had would zero it the moment a
 * second chip was touched.
 */
export function toggleTillMethod(
  total: number,
  parts: readonly TillPart[],
  method: TillMethod,
): readonly TillPart[] {
  if (parts.some((p) => p.method === method)) {
    return parts.filter((p) => p.method !== method);
  }
  if (parts.length === 0) return [{ method }];
  const { rows } = tillRows(total, parts);
  const lastIndex = parts.length - 1;
  return [
    ...parts.slice(0, lastIndex),
    { ...parts[lastIndex]!, split: rows[lastIndex]!.split },
    { method },
  ];
}
