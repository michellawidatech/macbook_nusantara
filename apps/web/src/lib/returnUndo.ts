/**
 * Taking a recorded return back, and correcting one (owner ask 2026-09-25).
 *
 * > *"Also add a delete / edit button in return row."*
 *
 * ## Why this is not a delete
 *
 * A return is a document, and this database does not hard-delete documents —
 * `ReturnRec.status` has carried `CANCELLED` since the beginning, for the QC
 * rejection that turns out to have named the wrong unit (2026-08-27). So the
 * row's delete button CANCELS: the document stays, marked withdrawn, and what
 * the return did to the shelf and to the bill is undone.
 *
 * ## What "undone" means, exactly
 *
 * A customer return writes five things: `RETUR_PELANGGAN` on each unit (back
 * to TERSEDIA, regraded), a `RETUR` adjustment per unit on each sale, a
 * `RETUR_PELANGGAN` stock move and a `returnedQty` bump per counted line, a
 * shrunken payment list, and — if money went back — a refund on the sale plus
 * a REFUND adjustment in Income & Expense.
 *
 * Undoing takes the first three back and deliberately leaves the last two:
 *
 * - **The adjustment goes, so the bill goes back up.** Since 2026-09-23 the
 *   DUE row is DERIVED from the bill (`withOwed`), so the debt the return
 *   cancelled comes back by itself. Nothing has to remember what was cut.
 * - **The refund STAYS.** If the shop handed a customer Rp5jt and then takes
 *   the return back, the customer has the unit *and* the shop's money, so they
 *   owe Rp5jt more than the original bill — which is exactly what
 *   `saleBalance` computes, because it subtracts `refunded` from what is
 *   settled. Deleting the refund row would claim the money never left the
 *   drawer, and the Income & Expense line that records it going is not a
 *   guess anybody should rewrite.
 *
 * ## What it refuses, and why each one
 *
 * The refusals are not caution for its own sake — each is a thing this undo
 * cannot prove, and a money reversal that guesses is worse than one that
 * declines:
 *
 * - `UNIT_MOVED` — a returned unit is no longer on the shelf the return put it
 *   on. It has been sold again, held, sent to service or written off, and the
 *   undo would have to contradict a later decision.
 * - `MARKETPLACE` — the return cancelled money a marketplace was holding.
 *   Nothing records how much came off which pending part, and re-inventing one
 *   would be a claim about Shopee's ledger the shop cannot make.
 * - `EXCHANGE` — replacements went out. `planReturn` moves a customer's money
 *   between sales as copies of the original payments, and which copy came from
 *   where is not written down.
 * - `BOOKS_CLOSED` — the sale is inside a closed period (`lib/bookClose.ts`),
 *   which is the same gate that stops a payment being recorded against it.
 * - `ALREADY_CANCELLED` — nothing to do.
 *
 * A supplier return has none of this money: it is refused only when the unit
 * has left `RETUR_SUPPLIER`, or the row is already cancelled.
 *
 * ⚠️ Editing is the other half and is deliberately narrow: `returnEdit` below
 * changes the return's own facts — when it happened, why, and what condition
 * each unit was recorded at. It never changes which units came back or what
 * they were worth, because those are the two things the money was computed
 * from. Correcting one of those is a cancel and a fresh return.
 */
import { isBookClosed, type BookCloseSettings } from "./bookClose.js";
import { holdsPendingMoney } from "./channels.js";
import { OWED_ID_SUFFIX } from "./salePayments.js";

/** Why an undo cannot be done. */
export type UndoRefusal =
  | "ALREADY_CANCELLED"
  | "UNIT_MOVED"
  | "MARKETPLACE"
  | "EXCHANGE"
  | "BOOKS_CLOSED";

export type UndoCheck =
  { readonly ok: true } | { readonly ok: false; readonly why: UndoRefusal };

/** The shape of a returned unit this rule needs. */
export interface UndoUnit {
  readonly serial: string;
  readonly status: string;
}

/** The shape of a sale this rule needs. */
export interface UndoSale {
  readonly id: string;
  readonly code: string;
  readonly ts: string;
  readonly source: string;
  readonly payments?: readonly { readonly state: string }[];
  readonly settled?: boolean;
  readonly total?: number;
  readonly adjustments?: readonly {
    readonly type: string;
    /** A B2Soft document's lines can share one; an old row may have none. */
    readonly code?: string;
  }[];
}

/** One return document inside the row being undone. */
export interface UndoRec {
  readonly id: string;
  readonly code: string;
  readonly kind: "CUSTOMER" | "SUPPLIER";
  readonly serial: string;
  readonly status: string;
  readonly exchangeSerial?: string;
}

export interface UndoInput {
  readonly recs: readonly UndoRec[];
  /** The sales the row's codes touch — customer side only. */
  readonly sales: readonly UndoSale[];
  /** Every unit named by the row, by serial. */
  readonly units: ReadonlyMap<string, UndoUnit>;
  readonly settings?: BookCloseSettings;
  /** Counted pieces have no unit; their moves are named here. */
  readonly countedCodes?: readonly string[];
}

/**
 * The status a returned unit must still be in for the undo to be clean.
 *
 * A customer return put it back on the shelf; a supplier return sent it out.
 * Anything else means a later decision was taken about that unit, and this
 * would overwrite it.
 */
const EXPECTED_STATUS: Record<"CUSTOMER" | "SUPPLIER", string> = {
  CUSTOMER: "TERSEDIA",
  SUPPLIER: "RETUR_SUPPLIER",
};

export function canUndoReturn(input: UndoInput): UndoCheck {
  const live = input.recs.filter((r) => r.status !== "CANCELLED");
  // A row of nothing but cancelled documents, or of counted moves alone, has
  // no document left to withdraw.
  if (live.length === 0 && (input.countedCodes ?? []).length === 0)
    return { ok: false, why: "ALREADY_CANCELLED" };

  for (const r of live) {
    // An exchange moved money between sales as copies of the parts it came
    // from; which copy is which was never written down.
    if (r.exchangeSerial !== undefined) return { ok: false, why: "EXCHANGE" };
    const unit = input.units.get(r.serial);
    // A unit the store has never heard of cannot be put back.
    if (unit === undefined) return { ok: false, why: "UNIT_MOVED" };
    if (unit.status !== EXPECTED_STATUS[r.kind])
      return { ok: false, why: "UNIT_MOVED" };
  }

  for (const sale of input.sales) {
    // Locked only once finished (2026-10-22, `isSaleLocked`): settled, with
    // nothing pending or owed. This file holds the slim `UndoSale`, so the
    // same reading is made off its flag and its payments' states.
    if (
      isBookClosed(sale.ts, input.settings) &&
      sale.settled === true &&
      !(sale.payments ?? []).some((p) => p.state !== "SETTLED")
    )
      return { ok: false, why: "BOOKS_CLOSED" };
    /*
     * Marketplace money. The conservative reading, on purpose: a sale whose
     * channel can hold money, or which still has a pending part, may have had
     * pending money cut by this return — and `applyReturnCredit` records
     * nothing about which part it came off. `holdsPendingMoney` is the same
     * function Receivables and Income & Expense ask (2026-09-20).
     */
    if (holdsPendingMoney(sale.source))
      return { ok: false, why: "MARKETPLACE" };
    if ((sale.payments ?? []).some((p) => p.state === "PENDING"))
      return { ok: false, why: "MARKETPLACE" };
  }

  return { ok: true };
}

/**
 * The sale's payment rows that are NOT the derived shortfall.
 *
 * `withOwed` appends one DUE row computed from the bill, so an undo that
 * raises the bill has to hand the entered rows back and let it be derived
 * again rather than keeping the stale one.
 */
export function enteredPayments<
  P extends { readonly id: string; readonly state: string },
>(orderId: string, payments: readonly P[]): P[] {
  return payments.filter(
    (p) => !(p.state === "DUE" && p.id === `${orderId}${OWED_ID_SUFFIX}`),
  );
}

/** What an edit may change: the return's own facts, and nothing else. */
export interface ReturnEdit {
  readonly date: string;
  readonly reason: string;
  readonly reasonDetail?: string;
  /** The condition each unit is recorded at, by serial. Absent leaves it. */
  readonly grades?: Readonly<Record<string, string>>;
}

/**
 * Apply an edit to one return document.
 *
 * `afterGrade` is what the history prints, so a corrected condition has to
 * move with the unit's own grade — the caller writes that in the same
 * mutation, exactly as `applyStockHistoryEdit` does for a movement's reading.
 */
export function applyReturnEdit<R extends UndoRec & ReturnEdit>(
  rec: R,
  edit: ReturnEdit,
): R & { afterGrade?: string } {
  const grade = edit.grades?.[rec.serial];
  return {
    ...rec,
    date: edit.date,
    reason: edit.reason,
    ...(edit.reasonDetail
      ? { reasonDetail: edit.reasonDetail }
      : { reasonDetail: undefined }),
    ...(grade === undefined ? {} : { afterGrade: grade }),
  };
}

/** Sales a row's return codes name, by their `RETUR` adjustments. */
export function salesOfCodes<S extends UndoSale>(
  sales: readonly S[],
  codes: readonly string[],
): S[] {
  const want = new Set(codes);
  return sales.filter((s) =>
    (s.adjustments ?? []).some(
      (a) => a.type === "RETUR" && a.code !== undefined && want.has(a.code),
    ),
  );
}
