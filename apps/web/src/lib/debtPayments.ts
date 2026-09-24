/**
 * Writing one allocated payment onto the document it settles — an invoice, a
 * sale, or a debt from before this app.
 *
 * `lib/allocatePayment.ts` decides HOW MUCH each document gets; this file
 * decides what that money looks like once it is on the document, which is
 * the part a later screen reads back and so the part a test must pin:
 *
 * - **An invoice** takes the money on its goods first and then on each unpaid
 *   expense in turn, each part naming the expense it paid (`feeId`). One lump
 *   against the goods would add up to the right total and leave the Inbound
 *   page saying the ongkir was still unpaid — the question `appliedTo` was
 *   added to answer (2026-08-27).
 * - **A sale** takes the money off what the customer promised (`DUE`) and off
 *   a pending part on a channel that holds no money — the old-sale shape
 *   `customerDebtOf` explains — and records one `SETTLED` payment for the
 *   lot. Only a promise is shrunk; a marketplace's money is never touched.
 * - **An opening balance** keeps its figure and gains a payment. What was
 *   owed on the day the shop started using this app is a fact about that
 *   day, and rewriting it would make the history say something else.
 *
 * The balance switch (owner answer 2026-09-22) rides on every part as
 * `inBalance: false`, and is left off when on — absent is "it counts", the
 * reading of every payment written before the switch.
 *
 * Pure: no React, no store. `test/debtPayments.test.ts` is the spec.
 */
import { holdsPendingMoney } from "./channels.js";
import { payTargetOfFee, poTotals } from "./inbound.js";
import { paymentsOf, type SalePayment } from "./salePayments.js";
import type { OpeningPayment, Order, Po, PoPayment } from "../mock/seed.js";

/** What every part of one payment shares. */
export interface PaymentBase {
  /** A `PaymentMethod` code. */
  readonly method: string;
  readonly at: string;
  /** False when the money did not pass through the shop's cash or bank. */
  readonly inBalance: boolean;
  readonly note?: string;
}

const balanceFlag = (base: PaymentBase) =>
  base.inBalance ? {} : { inBalance: false as const };

/** Σ paid off an opening balance. */
export function openingPaidOf(party: {
  readonly openingPayments?: readonly { readonly amount: number }[];
}): number {
  return (party.openingPayments ?? []).reduce(
    (n, p) => n + Math.max(0, p.amount),
    0,
  );
}

/** What is still owed of a debt from before this app. Never negative. */
export function openingOwed(party: {
  readonly openingBalance?: number;
  readonly openingPayments?: readonly { readonly amount: number }[];
}): number {
  return Math.max(
    0,
    Math.max(0, party.openingBalance ?? 0) - openingPaidOf(party),
  );
}

/**
 * The payment parts `amount` becomes on one invoice.
 *
 * Capped at what the invoice still owes: a caller that asks for more gets
 * parts adding up to the outstanding figure, and the rest is the caller's to
 * put somewhere (a deposit, on the supplier side).
 */
export function invoicePaymentParts(
  po: Po,
  amount: number,
  base: PaymentBase,
  newId: () => string,
): PoPayment[] {
  const totals = poTotals(po);
  let left = Math.min(Math.max(0, amount), totals.outstanding);
  const parts: PoPayment[] = [];
  const push = (take: number, extra: Partial<PoPayment>) => {
    if (take <= 0) return;
    parts.push({
      id: newId(),
      method: base.method,
      amount: take,
      at: base.at,
      appliedTo: "ORDER",
      ...extra,
      ...balanceFlag(base),
    });
    left -= take;
  };
  push(Math.min(left, totals.goods.owed), {});
  for (const s of totals.feeStandings) {
    if (left <= 0) break;
    push(Math.min(left, s.owed), {
      appliedTo: payTargetOfFee(s.fee.kind),
      feeId: s.fee.id,
    });
  }
  // Outstanding that neither the goods nor an expense accounts for — a
  // discount larger than the goods can leave some — is still the invoice's.
  push(left, {});
  return parts;
}

/**
 * A sale's payment list once `amount` has been paid towards it.
 *
 * The earliest promise is kept first, so the part that goes is the one due
 * soonest. `amount` is capped at nothing here — the dialog refuses paying a
 * customer more than they owe (owner answer 2026-09-22) — but a larger figure
 * still only shrinks what is promised, and the payment records the whole of
 * it, so nothing a person typed is lost.
 */
export function salePaymentsAfter(
  order: Order,
  amount: number,
  base: PaymentBase,
  id: string,
): SalePayment[] {
  let left = Math.max(0, amount);
  if (left <= 0) return [...paymentsOf(order)];
  /** A part a person still owes: a promise, or pending where nothing waits. */
  const owedPart = (p: SalePayment) =>
    p.state === "DUE" ||
    (p.state === "PENDING" && !holdsPendingMoney(p.channel ?? order.source));
  const current = paymentsOf(order);
  const owing = current
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => owedPart(p))
    .sort(
      (a, b) =>
        (a.p.dueAt ?? a.p.at).localeCompare(b.p.dueAt ?? b.p.at) || a.i - b.i,
    );
  const shrunk = new Map<number, number>();
  for (const { p, i } of owing) {
    if (left <= 0) break;
    const take = Math.min(left, p.amount);
    shrunk.set(i, p.amount - take);
    left -= take;
  }
  const next: SalePayment[] = [];
  current.forEach((p, i) => {
    const after = shrunk.get(i);
    if (after === undefined) next.push(p);
    else if (after > 0) next.push({ ...p, amount: after });
  });
  next.push({
    id,
    method: base.method,
    amount: Math.max(0, amount),
    state: "SETTLED",
    at: base.at,
    ...(base.note ? { note: base.note } : {}),
    ...balanceFlag(base),
  });
  return next;
}

/** One payment off an opening balance. */
export function openingPayment(
  amount: number,
  base: PaymentBase,
  id: string,
): OpeningPayment {
  return {
    id,
    method: base.method,
    amount: Math.max(0, amount),
    at: base.at,
    ...(base.note ? { note: base.note } : {}),
    ...balanceFlag(base),
  };
}
