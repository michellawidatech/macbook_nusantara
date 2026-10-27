/**
 * Reconciliation — the POS balance against what is really there (owner ask
 * 2026-10-27, answers "1B 2B 3B 4A"; docs/superpowers/specs/
 * 2026-10-27-reconciliation-design.md).
 *
 * ## What "the POS balance" is
 *
 * Exactly the Cash and Bank cards on Income & Expense, cash basis: the opening
 * balance plus every SETTLED, in-balance movement of that pot, up to the end
 * of the day. It is computed from the same rows (`lib/cashflowRows.ts`) by
 * the same function (`balancesOfRows`), so the two screens cannot disagree
 * about what the shop holds.
 *
 * ## Daily (bank AND cash)
 *
 * Somebody types the bank's balance and the counted drawer. A pot that agrees
 * is MATCHED. One that does not opens THAT DAY's movements of that pot, with
 * the amounts editable: an edit corrects the REAL record — a sale payment the
 * way Transaction History does (`withOwed`, the payment log), an adjustment,
 * a supplier payment, a deposit, a refund — and is refused where that
 * record's own screen would refuse it (`editBlock`). What it changed is kept
 * on the reconciliation (`edits`), before → after and who. Difference zero
 * after edits is ADJUSTED; a difference left needs a note and stays OPEN.
 *
 * "Changed since reconciled" (owner answer 2B) is derived and stored nowhere:
 * the POS balance of that day today against the one saved.
 *
 * ## POS entries the bank never saw (owner-approved 2026-10-27)
 *
 * A month is reconciled only once every POS bank movement the statement does
 * not show is paired with a line or SET ASIDE with a note (`asides`,
 * `ReconciliationAside`): `canCloseMonth` / `monthBlockers`. An aside is
 * withdrawn, never removed — by Undo, or by the movement being paired after
 * all (`withdrawPairedAsides`) — and a withdrawn one no longer counts.
 *
 * ## Deleting what a reconciliation names
 *
 * An adjustment a reconciliation corrected, added, matched or set aside (an
 * ACTIVE aside) cannot be deleted while that reconciliation is closed
 * (anything but OPEN): reopen it first. Once it is open the delete takes the
 * edit, the match and the aside with it — the database's doors are
 * `reconciliation_edit_drop` and `reconciliation_aside_drop`. A withdrawn
 * aside never blocks, and goes with the adjustment from any reconciliation.
 *
 * Pure: no React, no store. Mutation helpers take the draft and are called
 * inside `mutate`. `test/reconciliation.test.ts` is the spec.
 */
import dayjs from "dayjs";
import type {
  MockDb,
  MoneyRef,
  Reconciliation,
  ReconciliationAside,
  ReconciliationEdit,
  StatementLineRec,
  StatementMatch,
} from "../mock/seed.js";
import {
  matchStatement,
  type MatchReason,
  type MatchResult,
  type Pairing,
  type PosMovement,
  type SuggestionReason,
} from "./bankMatch.js";
import { accountOfMethod } from "./accounts.js";
import { isBookClosed, isSaleLocked } from "./bookClose.js";
import {
  balancesOfRows,
  movesBalance,
  type CashflowRow,
  type MovementSource,
  type OpeningSettings,
} from "./cashflowRows.js";
import { poClosed } from "./inbound.js";
import { diffPayments, type PendingLogEntry } from "./paymentEdits.js";
import {
  billAfterReturns,
  enteredPayments,
  isSettled,
  owedDueAt,
  paymentsOf,
  refundedOf,
  withOwed,
} from "./salePayments.js";
import { allocatedOf } from "./supplierLedger.js";
import { transferPartner } from "./adjustmentDeletion.js";

export type Pot = "BANK" | "CASH";

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** The local calendar day of an instant — the shop's day (Asia/Jakarta). */
export const localDay = (at: string): string => dayjs(at).format("YYYY-MM-DD");

/** The first instant of the local day AFTER `day` — where a day ends. */
export const endOfLocalDay = (day: string): string =>
  dayjs(day).add(1, "day").startOf("day").toISOString();

/** The day before. */
export const dayBefore = (day: string): string =>
  dayjs(day).subtract(1, "day").format("YYYY-MM-DD");

/** A month ("YYYY-MM") as its first and last day. */
export function monthRange(month: string): { start: string; end: string } {
  const first = dayjs(`${month}-01`);
  return {
    start: first.format("YYYY-MM-DD"),
    end: first.endOf("month").format("YYYY-MM-DD"),
  };
}

// ---------------------------------------------------------------------------
// The POS side
// ---------------------------------------------------------------------------

/** Which pot a row's money is in, if any. */
export const potOf = (r: CashflowRow): Pot | undefined =>
  accountOfMethod(r.methodCode);

/** A row's amount with its sign: money in positive, out negative. */
export const signedAmount = (r: CashflowRow): number =>
  r.direction === "INCOME" ? r.amount : -r.amount;

/** The POS balance of a pot at the END of a local day. */
export function posBalanceAt(
  rows: readonly CashflowRow[],
  settings: OpeningSettings,
  pot: Pot,
  day: string,
): number {
  const b = balancesOfRows(rows, settings, { until: endOfLocalDay(day) });
  return pot === "BANK" ? b.bank : b.cash;
}

/**
 * The movements that make up a pot's balance between two local days,
 * inclusive, oldest first — a day's for the daily dialog, a month's for the
 * statement.
 */
export function potMovements(
  rows: readonly CashflowRow[],
  settings: OpeningSettings,
  pot: Pot,
  from: string,
  to: string,
): CashflowRow[] {
  return rows
    .filter((r) => {
      if (!movesBalance(r, settings) || potOf(r) !== pot) return false;
      const d = localDay(r.at);
      return d >= from && d <= to;
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// Naming a record
// ---------------------------------------------------------------------------

/** The record behind a row, in the four columns the database names it by. */
export function refOf(source: MovementSource): MoneyRef {
  switch (source.kind) {
    case "salePayment":
    case "openingPayment":
    case "poPayment":
      return { paymentId: source.paymentId };
    case "refund":
      return { paymentId: source.refundId };
    case "deposit":
      return { depositId: source.depositId };
    case "expense":
      return { expenseId: source.id };
    case "income":
      return { incomeId: source.id };
  }
}

/** One string per record, for maps and sets. */
export function refKey(ref: MoneyRef): string {
  if (ref.paymentId !== undefined) return `p:${ref.paymentId}`;
  if (ref.expenseId !== undefined) return `e:${ref.expenseId}`;
  if (ref.incomeId !== undefined) return `i:${ref.incomeId}`;
  return `d:${ref.depositId ?? ""}`;
}

/** The record a row stands for, keyed; undefined for a row that is no record. */
export const rowRefKey = (r: CashflowRow): string | undefined =>
  r.source === undefined ? undefined : refKey(refOf(r.source));

/** Only the reference fields of an edit or a match. */
export function moneyRefOf(x: MoneyRef): MoneyRef {
  return {
    ...(x.paymentId !== undefined ? { paymentId: x.paymentId } : {}),
    ...(x.expenseId !== undefined ? { expenseId: x.expenseId } : {}),
    ...(x.incomeId !== undefined ? { incomeId: x.incomeId } : {}),
    ...(x.depositId !== undefined ? { depositId: x.depositId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Correcting a record's amount
// ---------------------------------------------------------------------------

/** Why a record's amount cannot be corrected from here. */
export type EditBlock =
  | "NOT_FOUND"
  /** A finished sale inside a closed month (`isSaleLocked`). */
  | "SALE_LOCKED"
  /** A record dated inside a closed month. */
  | "BOOKS_CLOSED"
  /** A paid service charge: its amount follows the charge. */
  | "SERVICE_CHARGE"
  /** A closed supplier invoice is read-only until reopened. */
  | "INVOICE_CLOSED"
  /** A deposit cannot drop below what has been allocated out of it. */
  | "BELOW_ALLOCATED"
  /** Zero or less: delete the record on its own screen instead. */
  | "NOT_POSITIVE";

type EditDb = Pick<
  MockDb,
  | "orders"
  | "pos"
  | "deposits"
  | "expenses"
  | "incomes"
  | "customers"
  | "settings"
>;

/** Why `source` cannot be set to `amount`; undefined when it can. */
export function editBlock(
  db: EditDb,
  source: MovementSource,
  amount?: number,
): EditBlock | undefined {
  if (amount !== undefined && !(amount > 0)) return "NOT_POSITIVE";
  const closed = (at: string | undefined) => isBookClosed(at, db.settings);
  const dayClosed = (day: string) =>
    closed(dayjs(day).startOf("day").toISOString());
  switch (source.kind) {
    case "salePayment":
    case "refund": {
      const o = db.orders.find((x) => x.id === source.orderId);
      if (o === undefined) return "NOT_FOUND";
      if (isSaleLocked(o, db.settings)) return "SALE_LOCKED";
      if (source.kind === "salePayment") {
        if (!paymentsOf(o).some((p) => p.id === source.paymentId))
          return "NOT_FOUND";
      } else if (!(o.refunds ?? []).some((r) => r.id === source.refundId)) {
        return "NOT_FOUND";
      }
      return undefined;
    }
    case "openingPayment": {
      const c = db.customers.find((x) => x.id === source.customerId);
      const p = c?.openingPayments?.find((x) => x.id === source.paymentId);
      if (p === undefined) return "NOT_FOUND";
      return closed(p.at) ? "BOOKS_CLOSED" : undefined;
    }
    case "poPayment": {
      const po = db.pos.find((x) => x.id === source.poId);
      const p = po?.payments.find((x) => x.id === source.paymentId);
      if (po === undefined || p === undefined) return "NOT_FOUND";
      if (poClosed(po)) return "INVOICE_CLOSED";
      return closed(p.at) ? "BOOKS_CLOSED" : undefined;
    }
    case "deposit": {
      const d = db.deposits.find((x) => x.id === source.depositId);
      if (d === undefined) return "NOT_FOUND";
      if (closed(d.at)) return "BOOKS_CLOSED";
      if (amount !== undefined && amount < allocatedOf(d))
        return "BELOW_ALLOCATED";
      return undefined;
    }
    case "expense": {
      const e = db.expenses.find((x) => x.id === source.id);
      if (e === undefined) return "NOT_FOUND";
      if (e.serviceFeeId !== undefined) return "SERVICE_CHARGE";
      return dayClosed(e.date) ? "BOOKS_CLOSED" : undefined;
    }
    case "income": {
      const i = db.incomes.find((x) => x.id === source.id);
      if (i === undefined) return "NOT_FOUND";
      return dayClosed(i.date) ? "BOOKS_CLOSED" : undefined;
    }
  }
}

/** One record's amount, before and after a correction. */
export interface MoneyEdit {
  readonly ref: MoneyRef;
  readonly before: number;
  readonly after: number;
}

export interface EditContext {
  readonly at: string;
  readonly staff: string;
  readonly nextId: (prefix: string) => string;
}

/**
 * Set a record's amount, the way its own screen would. Call inside `mutate`.
 *
 * Returns what moved — usually one record; a cash ↔ bank move is two halves of
 * one fact, so correcting one half corrects the other. Throws when
 * `editBlock` refuses: the caller asks first and says why.
 */
export function applyAmountEdit(
  d: MockDb,
  source: MovementSource,
  amount: number,
  ctx: EditContext,
): MoneyEdit[] {
  const block = editBlock(d, source, amount);
  if (block !== undefined) throw new Error(`reconciliation edit: ${block}`);
  switch (source.kind) {
    case "salePayment": {
      const o = d.orders.find((x) => x.id === source.orderId)!;
      const before = paymentsOf(o);
      const old = before.find((p) => p.id === source.paymentId)!;
      if (old.amount === amount) return [];
      const entered = enteredPayments(before).map((p) =>
        p.id === source.paymentId ? { ...p, amount } : p,
      );
      const bill = billAfterReturns(o);
      const next = withOwed(o.id, bill, entered, owedDueAt(before), ctx.at);
      o.payments = next;
      o.settled = isSettled(bill, next, refundedOf(o));
      const log: PendingLogEntry[] = diffPayments(before, next, {
        at: ctx.at,
        staff: ctx.staff,
        reason: "Rekonsiliasi",
      });
      for (const row of log)
        d.paymentLog.push({ id: ctx.nextId("plog"), ...row });
      return [
        { ref: { paymentId: old.id }, before: old.amount, after: amount },
      ];
    }
    case "refund": {
      const o = d.orders.find((x) => x.id === source.orderId)!;
      const r = (o.refunds ?? []).find((x) => x.id === source.refundId)!;
      if (r.amount === amount) return [];
      const before = r.amount;
      o.refunds = (o.refunds ?? []).map((x) =>
        x.id === r.id ? { ...x, amount } : x,
      );
      o.settled = isSettled(billAfterReturns(o), paymentsOf(o), refundedOf(o));
      return [{ ref: { paymentId: r.id }, before, after: amount }];
    }
    case "openingPayment": {
      const c = d.customers.find((x) => x.id === source.customerId)!;
      const p = c.openingPayments!.find((x) => x.id === source.paymentId)!;
      if (p.amount === amount) return [];
      const before = p.amount;
      p.amount = amount;
      return [{ ref: { paymentId: p.id }, before, after: amount }];
    }
    case "poPayment": {
      const po = d.pos.find((x) => x.id === source.poId)!;
      const p = po.payments.find((x) => x.id === source.paymentId)!;
      if (p.amount === amount) return [];
      const before = p.amount;
      p.amount = amount;
      return [{ ref: { paymentId: p.id }, before, after: amount }];
    }
    case "deposit": {
      const dep = d.deposits.find((x) => x.id === source.depositId)!;
      if (dep.amount === amount) return [];
      const before = dep.amount;
      d.deposits = d.deposits.map((x) =>
        x.id === dep.id ? { ...x, amount } : x,
      );
      return [{ ref: { depositId: dep.id }, before, after: amount }];
    }
    case "expense":
    case "income": {
      const kind = source.kind;
      const partner = transferPartner(d, { kind, id: source.id });
      const out: MoneyEdit[] = [];
      const set = (k: "expense" | "income", id: string) => {
        const row =
          k === "expense"
            ? d.expenses.find((x) => x.id === id)
            : d.incomes.find((x) => x.id === id);
        if (row === undefined || row.amount === amount) return;
        out.push({
          ref: k === "expense" ? { expenseId: id } : { incomeId: id },
          before: row.amount,
          after: amount,
        });
        row.amount = amount;
      };
      set(kind, source.id);
      if (partner !== undefined) set(partner.kind, partner.id);
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Saving a reconciliation
// ---------------------------------------------------------------------------

/** The status a daily count lands on (owner spec 2026-10-27). */
export function dailyStatus(
  difference: number,
  corrected: boolean,
): "MATCHED" | "ADJUSTED" | "OPEN" {
  if (difference !== 0) return "OPEN";
  return corrected ? "ADJUSTED" : "MATCHED";
}

/** The reconciliation of one pot on one day, if there is one. */
export function dailyOf(
  db: Pick<MockDb, "reconciliations">,
  pot: Pot,
  day: string,
): Reconciliation | undefined {
  return db.reconciliations.find(
    (r) => r.kind === "DAILY" && r.pot === pot && r.periodStart === day,
  );
}

/** The month's statement reconciliation, if there is one. */
export function monthlyOf(
  db: Pick<MockDb, "reconciliations">,
  month: string,
): Reconciliation | undefined {
  const { start } = monthRange(month);
  return db.reconciliations.find(
    (r) => r.kind === "MONTHLY" && r.pot === "BANK" && r.periodStart === start,
  );
}

/** Log rows for what a save corrected and added. */
export function editRows(
  edits: readonly MoneyEdit[],
  added: readonly { ref: MoneyRef; amount: number }[],
  ctx: EditContext,
): ReconciliationEdit[] {
  return [
    ...edits.map((e) => ({
      id: ctx.nextId("rce"),
      ...e.ref,
      action: "EDITED" as const,
      before: e.before,
      after: e.after,
      staff: ctx.staff,
      at: ctx.at,
    })),
    ...added.map((a) => ({
      id: ctx.nextId("rce"),
      ...a.ref,
      action: "ADDED" as const,
      after: a.amount,
      staff: ctx.staff,
      at: ctx.at,
    })),
  ];
}

export interface DailySave {
  readonly pot: Pot;
  readonly day: string;
  readonly posBalance: number;
  readonly actualBalance: number;
  readonly status: Reconciliation["status"];
  readonly note?: string;
  readonly edits: readonly ReconciliationEdit[];
}

/**
 * Write one pot's count for one day: a new row, or the same row again — a day
 * reconciled twice is one reconciliation (unique per kind, pot and day), its
 * log growing.
 */
export function upsertDaily(
  d: MockDb,
  save: DailySave,
  ctx: EditContext,
): Reconciliation {
  const existing = dailyOf(d, save.pot, save.day);
  const note = save.note?.trim();
  if (existing !== undefined) {
    existing.posBalance = save.posBalance;
    existing.actualBalance = save.actualBalance;
    existing.status = save.status;
    if (note) existing.note = note;
    else delete existing.note;
    existing.staff = ctx.staff;
    existing.updatedAt = ctx.at;
    existing.edits.push(...save.edits);
    return existing;
  }
  const rec: Reconciliation = {
    id: ctx.nextId("rcn"),
    kind: "DAILY",
    pot: save.pot,
    periodStart: save.day,
    periodEnd: save.day,
    posBalance: save.posBalance,
    actualBalance: save.actualBalance,
    status: save.status,
    ...(note ? { note } : {}),
    staff: ctx.staff,
    createdAt: ctx.at,
    updatedAt: ctx.at,
    edits: [...save.edits],
    asides: [],
  };
  d.reconciliations.push(rec);
  return rec;
}

/** Reopen a reconciliation: OPEN again, ready to be counted and edited. */
export function reopen(d: MockDb, id: string, ctx: EditContext): void {
  const rec = d.reconciliations.find((r) => r.id === id);
  if (rec === undefined) return;
  rec.status = "OPEN";
  rec.staff = ctx.staff;
  rec.updatedAt = ctx.at;
}

/**
 * Delete a reconciliation whole (owner ask 2026-10-27): the record with its
 * edit log and asides, and its statement lines with their matches. A
 * correction it already wrote to a real record STAYS — that was a real fix —
 * and the day or month reads as not reconciled again. The server does the
 * same through `reconciliation_delete`. Call inside `mutate`. Answers whether
 * there was anything to delete.
 */
export function deleteReconciliation(
  d: Pick<MockDb, "reconciliations" | "statementLines">,
  id: string,
): boolean {
  if (!d.reconciliations.some((r) => r.id === id)) return false;
  d.reconciliations = d.reconciliations.filter((r) => r.id !== id);
  d.statementLines = d.statementLines.filter((l) => l.reconciliationId !== id);
  return true;
}

/**
 * Has the POS balance of that day moved since it was reconciled? (owner
 * answer 2B: derived, nothing stored.) Only a closed count can have
 * "changed since" — an OPEN one is still being worked on.
 */
export function changedSinceReconciled(
  rec: Reconciliation,
  posNow: number,
): boolean {
  return rec.status !== "OPEN" && rec.posBalance !== posNow;
}

// ---------------------------------------------------------------------------
// What a reconciliation names, and deleting it
// ---------------------------------------------------------------------------

const sameRef = (a: MoneyRef, b: MoneyRef) =>
  refKey(moneyRefOf(a)) === refKey(moneyRefOf(b));

/**
 * Every reconciliation that names this record, by an edit, a match or an
 * ACTIVE aside — a withdrawn aside no longer says anything about it.
 */
export function reconciliationsNaming(
  db: Pick<MockDb, "reconciliations" | "statementLines">,
  ref: MoneyRef,
): Reconciliation[] {
  const ids = new Set<string>();
  for (const r of db.reconciliations) {
    if (r.edits.some((e) => sameRef(e, ref))) ids.add(r.id);
    if (activeAsides(r).some((a) => sameRef(a, ref))) ids.add(r.id);
  }
  for (const l of db.statementLines) {
    if (l.matches.some((m) => sameRef(m, ref))) ids.add(l.reconciliationId);
  }
  return db.reconciliations.filter((r) => ids.has(r.id));
}

/**
 * The closed reconciliation that keeps this record from being deleted, if
 * any — "reopen the reconciliation first".
 */
export function closedReconciliationNaming(
  db: Pick<MockDb, "reconciliations" | "statementLines">,
  ref: MoneyRef,
): Reconciliation | undefined {
  return reconciliationsNaming(db, ref).find((r) => r.status !== "OPEN");
}

/**
 * Take a record out of every OPEN reconciliation that names it — its edit
 * rows, its matches and its asides — before the record itself is deleted. A
 * line left with no match is unmatched again. A WITHDRAWN aside goes from any
 * reconciliation: it no longer counts, and its foreign key would stop the
 * delete. The server does the same (`releaseReconciliationRefs`, which
 * withdraws an active aside and then drops it through
 * `reconciliation_aside_drop`). Call inside `mutate`, after
 * `closedReconciliationNaming` said nothing.
 */
export function forgetRecord(
  d: Pick<MockDb, "reconciliations" | "statementLines">,
  ref: MoneyRef,
): void {
  for (const r of d.reconciliations) {
    if (r.asides.some((a) => sameRef(a, ref)))
      r.asides = r.asides.filter(
        (a) => !sameRef(a, ref) || (r.status !== "OPEN" && !a.withdrawnAt),
      );
    if (r.status !== "OPEN") continue;
    if (r.edits.some((e) => sameRef(e, ref)))
      r.edits = r.edits.filter((e) => !sameRef(e, ref));
  }
  const open = new Set(
    d.reconciliations.filter((r) => r.status === "OPEN").map((r) => r.id),
  );
  for (const l of d.statementLines) {
    if (!open.has(l.reconciliationId)) continue;
    if (!l.matches.some((m) => sameRef(m, ref))) continue;
    l.matches = l.matches.filter((m) => !sameRef(m, ref));
    if (l.matches.length === 0 && l.status !== "IGNORED")
      l.status = "UNMATCHED";
  }
}

// ---------------------------------------------------------------------------
// Monthly: the bank against its e-statement
// ---------------------------------------------------------------------------

/** A POS bank movement as matching sees it. */
export function toPosMovement(r: CashflowRow): PosMovement | undefined {
  const key = rowRefKey(r);
  if (key === undefined) return undefined;
  return { key, date: localDay(r.at), amount: signedAmount(r) };
}

/** A statement line, read and checked, in whole rupiah — what is stored. */
export interface UploadLine {
  readonly lineNo: number;
  readonly date: string;
  readonly description: string;
  readonly amount: number;
  readonly balance?: number;
}

export interface StatementUpload {
  readonly month: string;
  readonly file: string;
  readonly opening: number;
  readonly closing: number;
  readonly posOpening: number;
  readonly posClosing: number;
  readonly lines: readonly UploadLine[];
}

/** The key of a match's record, the way `rowRefKey` keys a row. */
export const matchKey = (m: StatementMatch): string => refKey(moneyRefOf(m));

/** The `MoneyRef` behind a movement key (`p:…`, `e:…`, `i:…`, `d:…`). */
export function refOfKey(key: string): MoneyRef {
  const id = key.slice(2);
  switch (key[0]) {
    case "p":
      return { paymentId: id };
    case "e":
      return { expenseId: id };
    case "i":
      return { incomeId: id };
    default:
      return { depositId: id };
  }
}

/**
 * Write a month's statement: the MONTHLY reconciliation (new, or the month's
 * own again — OPEN, because new lines are lines nobody has looked at), and
 * its lines, REPLACING the ones a previous upload left. The corrections a
 * previous upload led to stay: they were written to the real records and
 * logged on the reconciliation. Returns the reconciliation's id.
 */
export function uploadStatement(
  d: MockDb,
  up: StatementUpload,
  ctx: EditContext,
): string {
  const { start, end } = monthRange(up.month);
  let rec = monthlyOf(d, up.month);
  if (rec === undefined) {
    rec = {
      id: ctx.nextId("rcn"),
      kind: "MONTHLY",
      pot: "BANK",
      periodStart: start,
      periodEnd: end,
      posBalance: up.posClosing,
      actualBalance: up.closing,
      statementOpening: up.opening,
      statementClosing: up.closing,
      statementFile: up.file,
      status: "OPEN",
      staff: ctx.staff,
      createdAt: ctx.at,
      updatedAt: ctx.at,
      edits: [],
      asides: [],
    };
    d.reconciliations.push(rec);
  } else {
    rec.posBalance = up.posClosing;
    rec.actualBalance = up.closing;
    rec.statementOpening = up.opening;
    rec.statementClosing = up.closing;
    rec.statementFile = up.file;
    rec.status = "OPEN";
    rec.staff = ctx.staff;
    rec.updatedAt = ctx.at;
  }
  const id = rec.id;
  d.statementLines = d.statementLines.filter((l) => l.reconciliationId !== id);
  for (const l of up.lines) {
    d.statementLines.push({
      id: ctx.nextId("sl"),
      reconciliationId: id,
      lineNo: l.lineNo,
      date: l.date,
      description: l.description,
      amount: l.amount,
      ...(l.balance === undefined ? {} : { balance: l.balance }),
      status: "UNMATCHED",
      matches: [],
    });
  }
  return id;
}

/** A month's lines, in statement order. */
export function linesOf(
  db: Pick<MockDb, "statementLines">,
  recId: string,
): StatementLineRec[] {
  return db.statementLines
    .filter((l) => l.reconciliationId === recId)
    .sort((a, b) => a.lineNo - b.lineNo);
}

/** Every movement key a month's lines already name. */
export function matchedKeys(lines: readonly StatementLineRec[]): Set<string> {
  return new Set(lines.flatMap((l) => l.matches.map(matchKey)));
}

/**
 * Run the matcher over what is still unmatched and WRITE what it finds: an
 * EXACT or DATE_SHIFT pairing is a match at once; a suggestion is held on its
 * lines (SUGGESTED, the proposed pairing as matches with the suggestion's
 * reason) for a person to accept or reject. Returns the matcher's answer.
 */
export function runMatching(
  d: MockDb,
  recId: string,
  movements: readonly PosMovement[],
  nextId: (prefix: string) => string,
): MatchResult {
  const lines = linesOf(d, recId);
  const taken = matchedKeys(lines);
  const result = matchStatement(
    lines
      .filter((l) => l.status === "UNMATCHED")
      .map((l) => ({
        id: l.id,
        date: l.date,
        amount: l.amount,
        description: l.description,
      })),
    movements.filter((m) => !taken.has(m.key)),
  );
  const byId = new Map(lines.map((l) => [l.id, l]));
  const write = (p: Pairing, status: StatementLineRec["status"]) => {
    for (const lineId of p.lineIds) {
      const line = byId.get(lineId);
      if (line === undefined) continue;
      line.status = status;
      for (const key of p.movementKeys) {
        line.matches.push({
          id: nextId("sm"),
          ...refOfKey(key),
          reason: p.reason,
        });
      }
    }
  };
  for (const p of result.matched) write(p, "MATCHED");
  for (const s of result.suggestions) write(s, "SUGGESTED");
  return result;
}

/** A suggestion as it is held: its lines and the records they would pair with. */
export interface HeldSuggestion {
  readonly reason: SuggestionReason;
  readonly lineIds: readonly string[];
  readonly movementKeys: readonly string[];
}

/**
 * The suggestions a month holds, rebuilt from its SUGGESTED lines: lines that
 * share a record are one suggestion (a MERGE is several lines naming one
 * movement), and a line's records are one suggestion (a SPLIT).
 */
export function heldSuggestions(
  lines: readonly StatementLineRec[],
): HeldSuggestion[] {
  const out: HeldSuggestion[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.status !== "SUGGESTED" || seen.has(l.id)) continue;
    const reason = (l.matches[0]?.reason ?? "TYPO") as SuggestionReason;
    const keys = l.matches.map(matchKey);
    const group =
      reason === "MERGE"
        ? lines.filter(
            (x) =>
              x.status === "SUGGESTED" &&
              x.matches.some((m) => keys.includes(matchKey(m))),
          )
        : [l];
    for (const g of group) seen.add(g.id);
    out.push({ reason, lineIds: group.map((g) => g.id), movementKeys: keys });
  }
  return out;
}

/** Turn a held suggestion's lines back into unmatched ones. */
export function rejectSuggestion(d: MockDb, lineIds: readonly string[]): void {
  for (const l of d.statementLines) {
    if (!lineIds.includes(l.id)) continue;
    l.matches = [];
    l.status = "UNMATCHED";
  }
}

/** Confirm lines as matched as they stand — what accepting SPLIT or MERGE is. */
export function confirmLines(d: MockDb, lineIds: readonly string[]): void {
  for (const l of d.statementLines) {
    if (lineIds.includes(l.id)) l.status = "MATCHED";
  }
}

/** Pair lines with records by hand. */
export function pairManually(
  d: MockDb,
  lineIds: readonly string[],
  keys: readonly string[],
  nextId: (prefix: string) => string,
): void {
  for (const l of d.statementLines) {
    if (!lineIds.includes(l.id)) continue;
    l.matches = keys.map((k) => ({
      id: nextId("sm"),
      ...refOfKey(k),
      reason: "MANUAL",
    }));
    l.status = "MATCHED";
    delete l.note;
  }
}

/** Add one record to a line's matches, with a reason, and call it matched. */
export function addMatch(
  d: MockDb,
  lineId: string,
  ref: MoneyRef,
  reason: MatchReason,
  nextId: (prefix: string) => string,
): void {
  const l = d.statementLines.find((x) => x.id === lineId);
  if (l === undefined) return;
  l.matches.push({ id: nextId("sm"), ...moneyRefOf(ref), reason });
  l.status = "MATCHED";
}

/** Set a line aside: the bank moved it and the POS should not (a note says why). */
export function ignoreLine(d: MockDb, lineId: string, note: string): void {
  const l = d.statementLines.find((x) => x.id === lineId);
  if (l === undefined) return;
  l.matches = [];
  l.status = "IGNORED";
  l.note = note.trim();
}

/** Take a line's match (or its "ignored") back. */
export function unmatchLine(d: MockDb, lineId: string): void {
  const l = d.statementLines.find((x) => x.id === lineId);
  if (l === undefined) return;
  l.matches = [];
  l.status = "UNMATCHED";
  delete l.note;
}

/** Log corrections on a reconciliation, and touch who and when. */
export function logEdits(
  d: MockDb,
  recId: string,
  rows: readonly ReconciliationEdit[],
  ctx: EditContext,
): void {
  const rec = d.reconciliations.find((r) => r.id === recId);
  if (rec === undefined || rows.length === 0) return;
  rec.edits.push(...rows);
  rec.staff = ctx.staff;
  rec.updatedAt = ctx.at;
}

/** Where a month stands, for its log row. */
export interface MonthCounts {
  /** Matched as the bank and the POS already agreed. */
  readonly matched: number;
  /** Matched after a correction: a typo fixed, a fee or a line added. */
  readonly fixed: number;
  /** Still to decide: unmatched, or a suggestion nobody has answered. */
  readonly left: number;
  readonly ignored: number;
}

const FIXING: ReadonlySet<string> = new Set(["TYPO", "DEDUCTION", "ADDED"]);

export function monthCounts(lines: readonly StatementLineRec[]): MonthCounts {
  let matched = 0;
  let fixed = 0;
  let left = 0;
  let ignored = 0;
  for (const l of lines) {
    if (l.status === "IGNORED") ignored += 1;
    else if (l.status !== "MATCHED") left += 1;
    else if (l.matches.some((m) => FIXING.has(m.reason))) fixed += 1;
    else matched += 1;
  }
  return { matched, fixed, left, ignored };
}

// ---------------------------------------------------------------------------
// POS-only movements set aside (owner-approved 2026-10-27)
// ---------------------------------------------------------------------------

/** The asides that still count: not withdrawn. */
export const activeAsides = (
  rec: Pick<Reconciliation, "asides">,
): ReconciliationAside[] => rec.asides.filter((a) => !a.withdrawnAt);

/** The active aside on this record in this month, if there is one. */
export function asideFor(
  rec: Pick<Reconciliation, "asides">,
  key: string,
): ReconciliationAside | undefined {
  return activeAsides(rec).find((a) => refKey(moneyRefOf(a)) === key);
}

/**
 * Set a POS-only movement aside with a note — why the bank never saw it. One
 * active aside per movement: setting it aside again changes nothing.
 */
export function setAside(
  d: Pick<MockDb, "reconciliations">,
  recId: string,
  key: string,
  note: string,
  ctx: EditContext,
): void {
  const rec = d.reconciliations.find((r) => r.id === recId);
  const text = note.trim();
  if (rec === undefined || rec.kind !== "MONTHLY" || text === "") return;
  if (asideFor(rec, key) !== undefined) return;
  rec.asides.push({
    id: ctx.nextId("ra"),
    ...refOfKey(key),
    note: text,
    staff: ctx.staff,
    at: ctx.at,
  });
}

/** Take an aside back (Undo): it stays, withdrawn, and stops counting. */
export function withdrawAside(
  d: Pick<MockDb, "reconciliations">,
  recId: string,
  asideId: string,
  at: string,
): void {
  const a = d.reconciliations
    .find((r) => r.id === recId)
    ?.asides.find((x) => x.id === asideId);
  if (a !== undefined && !a.withdrawnAt) a.withdrawnAt = at;
}

/**
 * Withdraw every active aside whose movement the month's lines now pair — a
 * movement set aside and then found on the statement after all is explained
 * by the bank, not by the note. Call after any pairing, inside `mutate`.
 */
export function withdrawPairedAsides(
  d: Pick<MockDb, "reconciliations" | "statementLines">,
  recId: string,
  at: string,
): void {
  const rec = d.reconciliations.find((r) => r.id === recId);
  if (rec === undefined) return;
  // MATCHED lines only: a suggestion nobody has answered pairs nothing yet,
  // and rejecting it puts the movement back in the list, note and all.
  const paired = matchedKeys(
    linesOf(d, recId).filter((l) => l.status === "MATCHED"),
  );
  for (const a of rec.asides) {
    if (!a.withdrawnAt && paired.has(refKey(moneyRefOf(a)))) a.withdrawnAt = at;
  }
}

/** What still keeps a month from being marked reconciled. */
export interface MonthBlockers {
  /** No statement uploaded — nothing to reconcile against. */
  readonly noLines: boolean;
  /** Statement lines unmatched, or a suggestion nobody answered. */
  readonly lines: number;
  /** POS bank movements the statement never shows, neither paired nor set aside. */
  readonly posOnly: number;
}

/**
 * Where a month stands against closing: every line matched or set aside, AND
 * every POS-only movement paired or explained (owner-approved 2026-10-27).
 * `posOnlyKeys` are the month's POS bank movements no line names.
 */
export function monthBlockers(
  lines: readonly StatementLineRec[],
  posOnlyKeys: readonly string[],
  rec: Pick<Reconciliation, "asides">,
): MonthBlockers {
  const explained = new Set(
    activeAsides(rec).map((a) => refKey(moneyRefOf(a))),
  );
  return {
    noLines: lines.length === 0,
    lines: monthCounts(lines).left,
    posOnly: posOnlyKeys.filter((k) => !explained.has(k)).length,
  };
}

/** May the month be marked reconciled? Nothing in `monthBlockers` is left. */
export const canCloseMonth = (
  lines: readonly StatementLineRec[],
  posOnlyKeys: readonly string[],
  rec: Pick<Reconciliation, "asides">,
): boolean => {
  const b = monthBlockers(lines, posOnlyKeys, rec);
  return !b.noLines && b.lines === 0 && b.posOnly === 0;
};

/**
 * The pots of a day still to be counted — what Income & Expense's "Today
 * isn't reconciled" line asks. A count left OPEN is not a count.
 */
export function unreconciledPots(
  db: Pick<MockDb, "reconciliations">,
  day: string,
): Pot[] {
  return (["BANK", "CASH"] as const).filter((pot) => {
    const r = dailyOf(db, pot, day);
    return r === undefined || r.status === "OPEN";
  });
}
