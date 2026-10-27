/**
 * A unit going back to its supplier, and the MONEY that comes with it (owner
 * 2026-10-26, docs/superpowers/specs/2026-10-26-service-returns-qc-design.md
 * §3).
 *
 * > *"If returned, then the user can enter the amount in which they receive in
 * > the bank again (default to the unit price without the service fee, but it
 * > is editable, display the service fee and then a button to add the service
 * > fee as well). But sometimes it is not paid yet, so it can be marked as not
 * > paid from supplier as well. They can also choose how the returned money
 * > goes: Bank account, other bank account, cash."*
 *
 * Until this a supplier return recorded an `expectedCredit` and nothing else:
 * the invoice still said the shop owed the whole delivery, and the money the
 * supplier sent back was nowhere.
 *
 * ## Rule C (owner answer)
 *
 * *"The credit first comes off what the unit's invoice still has unpaid;
 * anything left is a refund we receive now or mark as awaited."*
 *
 * - `applied = min(credit, invoice owed)` is a `PoPayment` with method
 *   `RETUR_SUPPLIER`, `inBalance: false` and the return's id — the invoice
 *   owes less and no pot moved (`lib/accounts.ts` gives the method no pot BY
 *   NAME). "Owed" is what the GOODS still owe (`poTotals(po).goods.owed`): the
 *   credit is for goods going back, it is filed against the goods
 *   (`appliedTo: ORDER`), and a forwarder's unpaid ongkir is not the
 *   supplier's to knock off.
 * - The rest is the refund. Received now → a `ManualIncome` of reason REFUND
 *   naming the return, into Bank / Other bank / Cash. Not paid yet → nothing
 *   is written, and the return reads *Awaiting refund* =
 *   `credit − applied − received` until *Mark received* writes the income.
 *
 * ## Taking it back
 *
 * Withdrawing a return removes its credit from the invoice — the store voids
 * the payment — and leaves a refund already RECEIVED where it is, the rule
 * customer returns follow: the money really arrived, and the history says so
 * ("refund kept") rather than pretending otherwise.
 */
import { poTotals } from "./inbound.js";
import type {
  ManualIncome,
  Po,
  PoPayment,
  ReturnRec,
  UnitStatus,
} from "../mock/seed.js";

/** Where the refund part went — or that it has not come yet. */
export type RefundInto = "TRANSFER" | "TRANSFER_LUAR" | "TUNAI" | "AWAITED";

/** In the order the dialog offers them. */
export const REFUND_INTO: readonly RefundInto[] = [
  "TRANSFER",
  "TRANSFER_LUAR",
  "TUNAI",
  "AWAITED",
];

/** The methods money RECEIVED from a supplier can arrive by. */
export type RefundMethod = Exclude<RefundInto, "AWAITED">;
export const REFUND_METHODS: readonly RefundMethod[] = [
  "TRANSFER",
  "TRANSFER_LUAR",
  "TUNAI",
];

// ---------------------------------------------------------------------------
// Who may go back
// ---------------------------------------------------------------------------

export type SupplierReturnBlock = "HELD" | "NOT_IN_STOCK";

/**
 * May a unit in this status go back to its supplier? In QC, on the shelf or
 * at service — the owner: *"even if it is already accepted and QCed, it can
 * still be returned or serviced"*. A held unit is the customer's, and a sold
 * or already returned one is not the shop's to send.
 */
export function supplierReturnBlock(
  status: UnitStatus,
): SupplierReturnBlock | undefined {
  switch (status) {
    case "QC":
    case "TERSEDIA":
    case "SERVIS":
      return undefined;
    case "DIRESERVASI":
      return "HELD";
    default:
      return "NOT_IN_STOCK";
  }
}

// ---------------------------------------------------------------------------
// Rule C
// ---------------------------------------------------------------------------

/** What the goods on this invoice still owe — 0 without an invoice. */
export function invoiceOwedOf(po: Po | undefined): number {
  return po === undefined ? 0 : poTotals(po).goods.owed;
}

export interface CreditSplit {
  /** The credit, floored at zero and whole. */
  readonly credit: number;
  /** What the invoice still owed before the credit. */
  readonly owed: number;
  /** What comes off the invoice. */
  readonly applied: number;
  /** What the supplier pays back. */
  readonly refund: number;
}

export function splitCredit(credit: number, owed: number): CreditSplit {
  const c = Math.max(0, Math.round(credit));
  const o = Math.max(0, Math.round(owed));
  const applied = Math.min(c, o);
  return { credit: c, owed: o, applied, refund: c - applied };
}

export interface SupplierReturnMoneyInput {
  /** The `ReturnRec.id` both money rows name. */
  readonly returnId: string;
  readonly credit: number;
  /** The unit's invoice, as the mutation sees it. */
  readonly po: Po | undefined;
  readonly refundInto: RefundInto;
  /** The instant the credit is recorded at. */
  readonly at: string;
  /** The day a refund received is filed under. */
  readonly date: string;
  readonly paymentId: string;
  readonly incomeId: string;
  readonly note?: string;
}

export interface SupplierReturnMoneyPlan {
  readonly split: CreditSplit;
  /** The credit, to push onto `poId`'s payments. Absent when nothing applies. */
  readonly payment?: { readonly poId: string; readonly payment: PoPayment };
  /** The refund received now. Absent when awaited or nothing is refunded. */
  readonly income?: ManualIncome;
  /** What the income records — 0 without one. */
  readonly received: number;
}

export function planSupplierReturnMoney(
  input: SupplierReturnMoneyInput,
): SupplierReturnMoneyPlan {
  const split = splitCredit(input.credit, invoiceOwedOf(input.po));
  const payment =
    input.po !== undefined && split.applied > 0
      ? {
          poId: input.po.id,
          payment: {
            id: input.paymentId,
            method: "RETUR_SUPPLIER",
            amount: split.applied,
            at: input.at,
            appliedTo: "ORDER" as const,
            inBalance: false,
            returnId: input.returnId,
          },
        }
      : undefined;
  const income: ManualIncome | undefined =
    split.refund > 0 && input.refundInto !== "AWAITED"
      ? {
          id: input.incomeId,
          reason: "REFUND",
          amount: split.refund,
          date: input.date,
          method: input.refundInto,
          returnId: input.returnId,
          ...(input.note ? { note: input.note } : {}),
          createdAt: input.at,
        }
      : undefined;
  return {
    split,
    ...(payment ? { payment } : {}),
    ...(income ? { income } : {}),
    received: income?.amount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reading a return's money back
// ---------------------------------------------------------------------------

export function awaitingRefund(
  credit: number,
  applied: number,
  received: number,
): number {
  return Math.max(0, credit - applied - received);
}

type MoneyRec = Pick<ReturnRec, "id" | "status" | "expectedCredit"> & {
  readonly refundReceived?: number;
};

/**
 * What the supplier has paid back on this return.
 *
 * The incomes themselves when this account can see any naming it; otherwise
 * the figure the server derives onto the return (`refundReceived`), because
 * an account without finance access is sent no incomes at all and would
 * otherwise read every refund as still awaited — and offer to record it twice.
 */
export function refundReceivedOf(
  rec: MoneyRec,
  incomes: readonly ManualIncome[],
): number {
  const mine = incomes.filter(
    (i) => i.returnId === rec.id && i.reason === "REFUND",
  );
  if (mine.length > 0) return mine.reduce((n, i) => n + i.amount, 0);
  return rec.refundReceived ?? 0;
}

export interface ReturnMoney {
  readonly credit: number;
  /** What came off invoices, and which. */
  readonly applied: number;
  readonly invoices: readonly {
    readonly poId: string;
    readonly code: string;
    readonly amount: number;
  }[];
  readonly received: number;
  /** 0 on a withdrawn return: nothing is expected of the supplier any more. */
  readonly awaiting: number;
}

export function returnMoney(
  rec: MoneyRec,
  pos: readonly Pick<Po, "id" | "code" | "payments">[],
  incomes: readonly ManualIncome[],
): ReturnMoney {
  const invoices: { poId: string; code: string; amount: number }[] = [];
  for (const po of pos) {
    const amount = po.payments
      .filter((p) => p.returnId === rec.id)
      .reduce((n, p) => n + p.amount, 0);
    if (amount > 0) invoices.push({ poId: po.id, code: po.code, amount });
  }
  const applied = invoices.reduce((n, i) => n + i.amount, 0);
  const credit = rec.expectedCredit ?? 0;
  const received = refundReceivedOf(rec, incomes);
  return {
    credit,
    applied,
    invoices,
    received,
    awaiting:
      rec.status === "CANCELLED"
        ? 0
        : awaitingRefund(credit, applied, received),
  };
}

/**
 * Take a withdrawn return's credit off every invoice it was applied to.
 * Returns how much came off. The store voids the payment row; nothing else
 * on the invoice moves.
 */
export function withdrawSupplierReturnMoney(
  d: { readonly pos: Po[] },
  returnId: string,
): number {
  let removed = 0;
  for (const po of d.pos) {
    if (!po.payments.some((p) => p.returnId === returnId)) continue;
    removed += po.payments
      .filter((p) => p.returnId === returnId)
      .reduce((n, p) => n + p.amount, 0);
    po.payments = po.payments.filter((p) => p.returnId !== returnId);
  }
  return removed;
}
