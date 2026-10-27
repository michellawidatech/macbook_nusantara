/**
 * An adjustment typed into Income & Expense can be deleted (owner ask
 * 2026-10-24: *"we should be able to delete the income expense adjustment"*).
 *
 * The shop had typed two test expenses and then a third "Balance mismatch"
 * income to cancel them, which left three rows in the table that mean nothing
 * and a balance nobody could check by eye. Deleting the mistake is the fix the
 * 2026-10-22 rule asks for — *"a mistake should not cost lots of additional
 * steps"* — and an adjustment touches no unit, no sale and no ledger, so
 * nothing else has to follow it.
 *
 * Two rules:
 *
 * - **A cash ↔ bank move goes as a pair.** It is written as an `Expense` out
 *   of one pot and a `ManualIncome` into the other (`AdjustmentPanel`), with
 *   no id linking them; deleting one half would leave money that left the bank
 *   and never arrived in the drawer. The partner is the other half with the
 *   same day, amount and note.
 * - **A closed month keeps its adjustments**, as it keeps its sales: the
 *   figures were reported, and the book has to be reopened to change them.
 * - **A closed reconciliation keeps them too** (2026-10-27). One that
 *   corrected, added, matched or set aside (an active aside) the row names
 *   it, and the count it closed on would stop adding up; reopen the
 *   reconciliation first. Once it is open, the delete takes the
 *   reconciliation's edit, match and aside with it (`forgetRecord`) — the
 *   server does the same, and refuses the same. A withdrawn aside never
 *   blocks.
 */
import dayjs from "dayjs";
import { isBookClosed, type BookCloseSettings } from "./bookClose.js";
import type {
  Expense,
  ManualIncome,
  MockDb,
  MoneyRef,
  Reconciliation,
} from "../mock/seed.js";
import { closedReconciliationNaming, forgetRecord } from "./reconciliation.js";

export type AdjustmentRef =
  | { readonly kind: "expense"; readonly id: string }
  | { readonly kind: "income"; readonly id: string };

type Ledgers = Pick<MockDb, "expenses" | "incomes">;
type Reconciled = Pick<MockDb, "reconciliations" | "statementLines">;

const moneyRef = (r: AdjustmentRef): MoneyRef =>
  r.kind === "expense" ? { expenseId: r.id } : { incomeId: r.id };

/** The words a cash ↔ bank pair shares: the expense's label, the income's note. */
const moveNote = (e: Expense) => e.label ?? e.note ?? "";

function isPair(e: Expense, i: ManualIncome): boolean {
  return (
    e.kind === "TRANSFER" &&
    i.reason === "TRANSFER" &&
    e.date === i.date &&
    e.amount === i.amount &&
    e.method !== i.method &&
    moveNote(e) === (i.note ?? "")
  );
}

/** The other half of a cash ↔ bank move, when `ref` is one. */
export function transferPartner(
  db: Ledgers,
  ref: AdjustmentRef,
): AdjustmentRef | undefined {
  if (ref.kind === "expense") {
    const e = db.expenses.find((x) => x.id === ref.id);
    if (!e || e.kind !== "TRANSFER") return undefined;
    const i = db.incomes.find((x) => isPair(e, x));
    return i ? { kind: "income", id: i.id } : undefined;
  }
  const i = db.incomes.find((x) => x.id === ref.id);
  if (!i || i.reason !== "TRANSFER") return undefined;
  const e = db.expenses.find((x) => isPair(x, i));
  return e ? { kind: "expense", id: e.id } : undefined;
}

/** Why an adjustment dated `day` cannot be deleted; undefined when it can. */
export function adjustmentDeletionBlock(
  day: string,
  settings: BookCloseSettings | undefined,
): "BOOKS_CLOSED" | undefined {
  // The adjustment's day starts at local midnight; the closing instant is the
  // END of a local day, so a day inside the closed month compares below it.
  const start = dayjs(day).startOf("day").toISOString();
  return isBookClosed(start, settings) ? "BOOKS_CLOSED" : undefined;
}

/**
 * The closed reconciliation that names this adjustment (or its other half),
 * if one does — "reopen the reconciliation first".
 */
export function adjustmentReconciliationBlock(
  db: Ledgers & Reconciled,
  ref: AdjustmentRef,
): Reconciliation | undefined {
  const partner = transferPartner(db, ref);
  return [ref, ...(partner ? [partner] : [])]
    .map((r) => closedReconciliationNaming(db, moneyRef(r)))
    .find((r) => r !== undefined);
}

/**
 * Remove the adjustment, and its other half when it is a cash ↔ bank move.
 * Returns how many rows went — 0 when it was already gone.
 */
export function deleteAdjustment(
  db: Ledgers & Partial<Reconciled>,
  ref: AdjustmentRef,
): number {
  const refs = [ref];
  const partner = transferPartner(db, ref);
  if (partner) refs.push(partner);
  let removed = 0;
  for (const r of refs) {
    if (db.reconciliations && db.statementLines)
      forgetRecord(
        {
          reconciliations: db.reconciliations,
          statementLines: db.statementLines,
        },
        moneyRef(r),
      );
    const list: { id: string }[] =
      r.kind === "expense" ? db.expenses : db.incomes;
    const at = list.findIndex((x) => x.id === r.id);
    if (at < 0) continue;
    list.splice(at, 1);
    removed += 1;
  }
  return removed;
}
