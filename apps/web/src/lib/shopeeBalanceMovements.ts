/**
 * The Shopee balance's own movements — the rows of the seller balance report
 * that belong to no order (owner, 2026-11-23).
 *
 * > *"Add shopee as a payment method, so it will deduct the balance in shopee
 * > balance. Currently the balance did not sync."*
 *
 * The upload recorded each order's payout and left two kinds of row out:
 *
 * - **Ad top-ups** — "Pembayaran dengan Saldo Penjual · Isi Ulang Saldo
 *   Iklan/Koin Penjual", Rp111.000 most mornings, paid OUT of the balance.
 *   Nothing could record one, so the POS balance ran ahead of Shopee's by
 *   every top-up: Rp888.000 over the eight days to 23 Nov. Each is now an
 *   expense of kind MARKETING paid through `SALDO_SHOPEE`, which comes off
 *   the Shopee balance (`lib/marketplacePot.ts`) and nothing else.
 * - **Withdrawals** — "Penarikan Dana", the balance moving to the bank. Each
 *   is the `PENARIKAN_SHOPEE` income the Income & Expense dialog writes by
 *   hand: into the bank by transfer, out of the Shopee balance.
 *
 * Only what happened AFTER the balance's starting point is recorded: the
 * base is Shopee's own figure at an instant and already holds everything
 * before it. And a movement already in the POS — typed by hand, or written by
 * an earlier upload of an overlapping report — is not written again: per day
 * and amount, the report's count less the POS's count. Two Rp111.000 top-ups
 * on one day are two; uploading that day again adds none.
 *
 * Pure: no React, no store. `test/shopeeBalanceMovements.test.ts` is the spec.
 */
import type { Cell, XlsxSheet } from "./xlsxRead.js";
import type {
  Expense,
  ExpenseKind,
  IncomeReason,
  ManualIncome,
} from "../mock/seed.js";
import {
  balanceRowDone,
  parseAmount,
  releasedInstant,
  releasedText,
  type IncomeLayout,
} from "./shopeeIncome.js";

export type BalanceMovementKind = "AD_TOPUP" | "WITHDRAWAL";

/** One row of the report that moved the balance without an order. */
export interface BalanceMovement {
  readonly kind: BalanceMovementKind;
  /** ISO instant — Shopee's wall clock read as Asia/Jakarta. */
  readonly at: string;
  /** The Jakarta day it happened on, `YYYY-MM-DD`. */
  readonly date: string;
  /** Whole rupiah, always positive. */
  readonly amount: number;
  /** In Shopee's words: "Isi Ulang Saldo Iklan/Koin Penjual". */
  readonly label: string;
}

/** The expense a top-up becomes, and the method it is paid through. */
export const AD_TOPUP_KIND: ExpenseKind = "MARKETING";
export const SHOPEE_BALANCE_METHOD = "SALDO_SHOPEE";
/** The income a withdrawal becomes, and how it lands. */
export const SHOPEE_WITHDRAWAL_REASON: IncomeReason = "PENARIKAN_SHOPEE";
export const WITHDRAWAL_METHOD = "TRANSFER";

const text = (v: Cell | undefined): string =>
  v === null || v === undefined || typeof v === "boolean"
    ? ""
    : String(v).trim();

const AD_TOPUP =
  /isi ulang saldo iklan|koin penjual|\bads?\b.*\b(top.?up|balance|credit)\b/i;
const WITHDRAWAL = /penarikan dana|\bwithdraw/i;
/** An order number, or Shopee's "-" for a row that belongs to none. */
const NO_ORDER = /^-?$/;

/** What kind of balance movement a row is, from Shopee's own words. */
export function movementKind(
  type: string,
  description: string,
): BalanceMovementKind | undefined {
  const said = `${type} ${description}`;
  if (WITHDRAWAL.test(said)) return "WITHDRAWAL";
  if (AD_TOPUP.test(said)) return "AD_TOPUP";
  return undefined;
}

/**
 * Every ad top-up and withdrawal the report holds, oldest first. Empty for a
 * file that is not the seller balance report: only that report has them.
 * A row whose money has not moved yet ("Status" not done), or with no
 * readable time or amount, is left out rather than guessed at.
 */
export function balanceMovements(
  sheet: XlsxSheet,
  layout: IncomeLayout,
): BalanceMovement[] {
  const balance = layout.balance;
  if (
    balance === undefined ||
    layout.payout === undefined ||
    layout.released === undefined
  )
    return [];
  const out: BalanceMovement[] = [];
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (layout.order !== undefined && !NO_ORDER.test(text(row[layout.order])))
      continue;
    const kind = movementKind(
      balance.type === undefined ? "" : text(row[balance.type]),
      balance.description === undefined ? "" : text(row[balance.description]),
    );
    if (kind === undefined) continue;
    if (balance.status !== undefined && !balanceRowDone(row[balance.status]))
      continue;
    const amount = parseAmount(row[layout.payout]);
    const when = releasedText(row[layout.released]);
    const at = releasedInstant(when);
    if (amount === undefined || amount === 0 || at === undefined || !when)
      continue;
    const label =
      (balance.description === undefined
        ? ""
        : text(row[balance.description])) ||
      (balance.type === undefined ? "" : text(row[balance.type]));
    out.push({
      kind,
      at,
      date: when.slice(0, 10),
      amount: Math.abs(amount),
      label,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** What the POS already holds that a movement would duplicate. */
export interface RecordedMovements {
  readonly expenses: readonly Pick<
    Expense,
    "kind" | "method" | "date" | "amount"
  >[];
  readonly incomes: readonly Pick<ManualIncome, "reason" | "date" | "amount">[];
}

/** The plan for one upload: what to write, and what was left out and why. */
export interface MovementPlan {
  readonly toRecord: readonly BalanceMovement[];
  /** Already in the POS — same kind, day and amount. */
  readonly alreadyRecorded: number;
  /** At or before the balance's starting point: inside Shopee's figure. */
  readonly beforeBase: number;
}

const keyOf = (kind: BalanceMovementKind, date: string, amount: number) =>
  `${kind}|${date}|${amount}`;

/**
 * Which of the report's movements to record: after the base (`baseAt`, an
 * ISO instant; everything when there is none), less what the POS already
 * holds — counted per kind, day and amount, so a repeated upload adds
 * nothing and two equal top-ups on one day stay two.
 */
export function planMovements(
  moves: readonly BalanceMovement[],
  recorded: RecordedMovements,
  baseAt: string | undefined,
): MovementPlan {
  const have = new Map<string, number>();
  const bump = (k: string) => have.set(k, (have.get(k) ?? 0) + 1);
  for (const e of recorded.expenses)
    if (e.kind === AD_TOPUP_KIND && e.method === SHOPEE_BALANCE_METHOD)
      bump(keyOf("AD_TOPUP", e.date, e.amount));
  for (const i of recorded.incomes)
    if (i.reason === SHOPEE_WITHDRAWAL_REASON)
      bump(keyOf("WITHDRAWAL", i.date, i.amount));
  const toRecord: BalanceMovement[] = [];
  let alreadyRecorded = 0;
  let beforeBase = 0;
  for (const m of moves) {
    if (baseAt !== undefined && m.at <= baseAt) {
      beforeBase += 1;
      continue;
    }
    const k = keyOf(m.kind, m.date, m.amount);
    const left = have.get(k) ?? 0;
    if (left > 0) {
      have.set(k, left - 1);
      alreadyRecorded += 1;
      continue;
    }
    toRecord.push(m);
  }
  return { toRecord, alreadyRecorded, beforeBase };
}

/**
 * The rows a plan writes. `createdAt` is the movement's own instant, so
 * Income & Expense places it at the hour Shopee did (`typedAt`) — which is
 * also what the balance's starting point is compared with.
 */
export function movementWrites(
  moves: readonly BalanceMovement[],
  newId: (prefix: string) => string,
): { expenses: Expense[]; incomes: ManualIncome[] } {
  const expenses: Expense[] = [];
  const incomes: ManualIncome[] = [];
  for (const m of moves) {
    if (m.kind === "AD_TOPUP")
      expenses.push({
        id: newId("e"),
        kind: AD_TOPUP_KIND,
        amount: m.amount,
        date: m.date,
        createdAt: m.at,
        method: SHOPEE_BALANCE_METHOD,
        note: m.label,
      });
    else
      incomes.push({
        id: newId("mi"),
        reason: SHOPEE_WITHDRAWAL_REASON,
        amount: m.amount,
        date: m.date,
        createdAt: m.at,
        method: WITHDRAWAL_METHOD,
        note: m.label,
      });
  }
  return { expenses, incomes };
}
