/**
 * A marketplace payout, written — the one writer, used by Transaction
 * History's Shopee upload and by the Edit transaction dialog (owner ask
 * 2026-10-22: *"combine the transaction history and the pending payment … so
 * below the payment method Shopee, we should be able to add deduction
 * immediately, not just go to other page"*).
 *
 * It used to live in the Pending Payment page, which is gone. What a payout
 * IS has not changed (2026-09-08, 2026-09-20): one `Settlement` per marketplace
 * payment, its deductions as `fees`, `received = gross − Σ deductions`, and a
 * `SettlementLog` row every time the shop's account of it changes.
 *
 * ## The payment's state is the one switch
 *
 * A payment is PENDING while the platform holds the money and SETTLED once it
 * has landed; that is what the balance reads (`lib/accounts.ts`). Deductions
 * may be typed before the payout arrives (owner answer 2026-10-22: "a
 * Received switch per payment") — the settlement then records what WILL land
 * and the payment stays PENDING until somebody says it landed.
 *
 * Mutation bodies: call inside `mutate`.
 */
import type { MockDb } from "../mock/seed.js";
import { channelOf } from "./channels.js";
import { fmtRp } from "./format.js";
import {
  settlementTotals,
  type SettlementDraft,
  type SettlementFee,
} from "./marketplace.js";
import { paymentsOf } from "./salePayments.js";

export interface PayoutDeps {
  readonly staff: string;
  readonly at: string;
  readonly nextId: (prefix: string) => string;
  readonly appendEvent: (
    d: MockDb,
    serial: string,
    ev: { type: string; refCode?: string; note?: string },
  ) => void;
}

/**
 * Record payouts that LANDED (the Shopee upload): each payment PENDING →
 * SETTLED, one settlement and its RECORDED log row. A payment already settled
 * by the time this runs is skipped, and the caller is told how many were.
 */
export function recordPayouts(
  d: MockDb,
  channel: string,
  drafts: readonly SettlementDraft[],
  deps: PayoutDeps,
): { written: number; landed: number } {
  let written = 0;
  let landed = 0;
  for (const s of drafts) {
    const o = d.orders.find((x) => x.id === s.orderId);
    if (!o) continue;
    const parts = paymentsOf(o);
    const target = parts.find((p) => p.id === s.paymentId);
    if (target === undefined || target.state !== "PENDING") continue;
    o.payments = parts.map((p) =>
      p.id === s.paymentId
        ? { ...p, state: "SETTLED" as const, at: deps.at }
        : p,
    );
    o.settled = o.payments.every((p) => p.state === "SETTLED");
    upsertSettlement(
      d,
      {
        paymentId: s.paymentId,
        orderId: s.orderId,
        channel,
        gross: s.gross,
        fees: s.fees,
        at: deps.at,
        ...(s.reason ? { reason: s.reason } : {}),
      },
      deps,
    );
    for (const serial of o.serials) {
      deps.appendEvent(d, serial, {
        type: "DICATAT",
        refCode: o.code,
        note: `Withdrawal from ${channelOf(channel)?.label ?? channel}: ${fmtRp(s.received)}`,
      });
    }
    written += 1;
    landed += s.received;
  }
  return { written, landed };
}

/**
 * Write one payment's deductions: create its settlement or correct it, and
 * log either. `received` is always derived — gross less the deductions — so
 * the figure on the row and the figure in the dialog cannot disagree.
 * Returns false when nothing changed.
 */
export function upsertSettlement(
  d: MockDb,
  p: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly channel: string;
    readonly gross: number;
    readonly fees: readonly SettlementFee[];
    readonly at: string;
    readonly reason?: string;
  },
  deps: Pick<PayoutDeps, "staff" | "nextId">,
): boolean {
  const received = p.gross - p.fees.reduce((n, f) => n + f.amount, 0);
  const i = d.settlements.findIndex((s) => s.paymentId === p.paymentId);
  const was = i >= 0 ? d.settlements[i]! : undefined;
  if (
    was !== undefined &&
    was.gross === p.gross &&
    was.received === received &&
    was.at === p.at &&
    JSON.stringify(was.fees) === JSON.stringify(p.fees)
  )
    return false;
  const id = was?.id ?? deps.nextId("stl");
  const next = {
    id,
    paymentId: p.paymentId,
    orderId: p.orderId,
    channel: p.channel,
    gross: p.gross,
    fees: p.fees.map((f) => ({ ...f })),
    received,
    ...(p.reason ? { reason: p.reason } : {}),
    at: p.at,
    staff: deps.staff,
  };
  if (was === undefined) d.settlements.push(next);
  else d.settlements[i] = { ...next, staff: was.staff };
  const after = settlementTotals({ gross: p.gross, fees: p.fees, received });
  d.settlementLog.push({
    id: deps.nextId("slog"),
    settlementId: id,
    at: new Date().toISOString(),
    staff: deps.staff,
    action: was === undefined ? "RECORDED" : "AMENDED",
    ...(was === undefined
      ? {}
      : {
          before: {
            received: was.received,
            deducted: was.gross - was.received,
          },
        }),
    after: { received: after.received, deducted: after.deducted },
  });
  netOfOrder(d, p.orderId);
  return true;
}

/**
 * The sale's `grossTotal` / `netReceived` — what it netted after every
 * deduction a marketplace kept — re-derived from its settlements, so a
 * corrected deduction moves it rather than stacking on the last figure.
 */
export function netOfOrder(d: MockDb, orderId: string): void {
  const o = d.orders.find((x) => x.id === orderId);
  if (!o) return;
  const kept = d.settlements
    .filter((s) => s.orderId === orderId)
    .reduce((n, s) => n + (s.gross - s.received), 0);
  if (kept === 0) {
    delete o.grossTotal;
    delete o.netReceived;
    return;
  }
  o.grossTotal = o.total;
  o.netReceived = o.total - kept;
}
