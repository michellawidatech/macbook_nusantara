/**
 * Writing a payment correction: what changed, and the rows that record it.
 *
 * Pulled out of the page for the reason `lib/pos.ts` was: the diff between two
 * payment lists is the fiddly part, it decides what the log says forever, and
 * a test should be able to read it.
 *
 * Pure: no React, no store. `test/paymentEdits.test.ts` is the spec.
 */
import type { PaymentLogEntry, SalePayment } from "./salePayments.js";

/** One log row, minus the identity the store will give it. */
export type PendingLogEntry = Omit<PaymentLogEntry, "id">;

/**
 * What changed between what was stored and what somebody saved.
 *
 * Three shapes of change and no more: a payment appeared, one went, or one
 * moved. A row whose amount and state are both unchanged produces nothing —
 * fixing a typo in a note is not a financial correction and a log full of them
 * is a log nobody reads.
 *
 * Order is: removals, then amendments, then additions. It is the order the
 * change actually happened in from the reader's point of view — what went, what
 * moved, what arrived — and a stable order means two people looking at one
 * correction see it the same way.
 */
export function diffPayments(
  before: readonly SalePayment[],
  after: readonly SalePayment[],
  ctx: { readonly at: string; readonly staff: string; readonly reason?: string },
): PendingLogEntry[] {
  const was = new Map(before.map((p) => [p.id, p]));
  const now = new Map(after.map((p) => [p.id, p]));
  const out: PendingLogEntry[] = [];
  const base = {
    at: ctx.at,
    staff: ctx.staff,
    ...(ctx.reason ? { reason: ctx.reason } : {}),
  };

  for (const p of before) {
    if (now.has(p.id)) continue;
    out.push({
      paymentId: p.id,
      action: "REMOVED",
      before: { amount: p.amount, state: p.state },
      ...base,
    });
  }
  for (const p of after) {
    const old = was.get(p.id);
    if (!old) continue;
    if (old.amount === p.amount && old.state === p.state) continue;
    out.push({
      paymentId: p.id,
      action: "AMENDED",
      before: { amount: old.amount, state: old.state },
      after: { amount: p.amount, state: p.state },
      ...base,
    });
  }
  for (const p of after) {
    if (was.has(p.id)) continue;
    out.push({
      paymentId: p.id,
      action: "ADDED",
      after: { amount: p.amount, state: p.state },
      ...base,
    });
  }
  return out;
}
