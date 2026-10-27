/**
 * A DP holds a unit (owner, 2026-10-27 — "yes to DP";
 * docs/superpowers/specs/2026-10-27-dp-holds-design.md).
 *
 * *"They can make DP, they will have to DP 500k for 1 week. The status would
 * be sold only if paid. The payment status is manually verified by staff.
 * After that, back in stock."*
 *
 * - **Only a DP holds.** A reservation nobody paid for leaves its units on
 *   sale (`SOFT` in lib/reservations.ts). Recording a DP — staff, after
 *   checking the bank, never the bot — puts them `DIRESERVASI` with their
 *   ledger rows and sets `heldUntil` to the DP's moment plus the rule's days.
 * - **The DP is ONE payment for its whole life.** It comes in on its day (a
 *   `Payment` MASUK naming the reservation), and the sale that finally takes
 *   it adopts the SAME row (`SalePayment.reservationId`). So the cash balance
 *   counts it once, when it came in, and the sale's bill is paid by it.
 * - **Past `heldUntil`** the worker puts the units back on sale and the hold
 *   waits on staff: **Refund** (a payment KELUAR out of the pot it came in) or
 *   **Keep** — the DP stays where it is and the reservation closes; Income &
 *   Expense reads it as *DP hangus* from then on. No second row: the money
 *   arrived once and is already in the balance.
 *
 * Pure, apart from the `draft` the mutations are handed.
 */
import {
  DP_DEFAULT_AMOUNT,
  DP_DEFAULT_DAYS,
  heldUntilOf,
  type DpRule,
} from "@nusantara/domain";
import type { AppSettings, MockDb, Reservation } from "../mock/seed.js";
import type { SalePayment } from "./salePayments.js";
import { heldItems, itemState, reprojectHolds } from "./reservations.js";

/** The rule from Settings, each half defaulting (Rp500.000, 7 days). */
export function dpRule(
  settings: Pick<AppSettings, "dpAmount" | "dpDays">,
): DpRule {
  const ok = (n: number | undefined) =>
    n !== undefined && Number.isInteger(n) && n > 0;
  return {
    amount: ok(settings.dpAmount) ? settings.dpAmount! : DP_DEFAULT_AMOUNT,
    days: ok(settings.dpDays) ? settings.dpDays! : DP_DEFAULT_DAYS,
  };
}

/** The two ways a DP is paid at the counter (`PaymentMethod` codes). */
export const DP_METHODS = ["TRANSFER", "TUNAI"] as const;
export type DpMethod = (typeof DP_METHODS)[number];

/**
 * What became of a reservation's DP.
 *
 * - `HOLDING` — the units are held and `heldUntil` has not passed.
 * - `DECIDE` — nothing is held any more (the hold ran out, or was let go)
 *   and staff must refund or keep the money.
 * - `APPLIED` — a sale took it.
 * - `REFUNDED` — handed back.
 * - `KEPT` — kept ("hangus"): the reservation closed with the money still in.
 */
export type DpStage = "HOLDING" | "DECIDE" | "APPLIED" | "REFUNDED" | "KEPT";

export function dpStage(
  db: MockDb,
  r: Reservation,
  now: Date = new Date(),
): DpStage | undefined {
  const dp = r.dp;
  if (dp === undefined) return undefined;
  if (dp.orderId !== undefined) return "APPLIED";
  if (dp.refund !== undefined) return "REFUNDED";
  if (r.status === "CANCELLED") return "KEPT";
  const held = r.items.some((i) => itemState(db, i, r) === "HELD");
  return held &&
    r.heldUntil !== undefined &&
    new Date(r.heldUntil).getTime() > now.getTime()
    ? "HOLDING"
    : "DECIDE";
}

/**
 * The units a paid DP holds right now, each with the reservation holding it
 * (owner, 2026-10-27: a DP holds a unit — "off sale for anyone else"). The
 * till leaves these out of what it can sell, unless the sale is being made
 * FROM that reservation.
 */
export function dpHeldSerials(
  db: MockDb,
  now: Date = new Date(),
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.reservations) {
    if (dpStage(db, r, now) !== "HOLDING") continue;
    for (const i of r.items) {
      if (i.serial && itemState(db, i, r) === "HELD") out.set(i.serial, r.id);
    }
  }
  return out;
}

/** The DP a sale from this reservation would take, if it has one to take. */
export function dpToApply(r: Reservation): SalePayment | undefined {
  const dp = r.dp;
  if (dp === undefined || dp.orderId !== undefined || dp.refund !== undefined)
    return undefined;
  if (r.status === "CANCELLED") return undefined;
  return {
    id: dp.id,
    method: dp.method,
    amount: dp.amount,
    state: "SETTLED",
    at: dp.at,
    reservationId: r.id,
    ...(dp.note ? { note: dp.note } : {}),
  };
}

/** Why a DP cannot be recorded on this reservation, if it cannot. */
export type RecordDpBlock = "NOT_OPEN" | "HAS_DP" | "NOTHING_TO_HOLD";

export function recordDpBlock(
  db: MockDb,
  r: Reservation,
): RecordDpBlock | undefined {
  if (r.status !== "ACTIVE") return "NOT_OPEN";
  if (r.dp !== undefined) return "HAS_DP";
  if (
    !r.items.some((i) => {
      const s = itemState(db, i, r);
      return s === "SOFT" || s === "HELD";
    })
  )
    return "NOTHING_TO_HOLD";
  return undefined;
}

export interface DpInput {
  readonly id: string;
  readonly amount: number;
  readonly method: string;
  /** When the money came in — an ISO instant. */
  readonly at: string;
  readonly note?: string;
}

/**
 * Record a DP and make the hold firm, in ONE mutation (the caller's `draft`):
 * the payment, `heldUntil`, and a `DIRESERVASI` ledger row for every unit the
 * hold still wants that is on sale. `appendEvent` is passed in so this file
 * stays free of the store.
 */
export function recordDp(
  draft: MockDb,
  reservationId: string,
  input: DpInput,
  rule: DpRule,
  appendEvent: (
    d: MockDb,
    serial: string,
    ev: { type: string; toStatus?: string; refCode?: string; note?: string },
  ) => void,
): readonly string[] {
  const r = draft.reservations.find((x) => x.id === reservationId);
  if (r === undefined || recordDpBlock(draft, r) !== undefined) return [];
  const firm = r.items
    .filter((i) => itemState(draft, i, r) === "SOFT")
    .map((i) => i.serial);
  r.dp = {
    id: input.id,
    method: input.method,
    amount: input.amount,
    at: input.at,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  r.heldUntil = heldUntilOf(new Date(input.at), rule.days).toISOString();
  for (const serial of firm)
    appendEvent(draft, serial, {
      type: "DIRESERVASI",
      toStatus: "DIRESERVASI",
      refCode: r.code,
    });
  reprojectHolds(draft, firm);
  return firm;
}

/**
 * Let go of whatever the hold still holds — a decision ends the hold, and a
 * hold decided before it ran out ended when it was decided (`heldUntil`).
 */
function releaseHeld(
  draft: MockDb,
  r: Reservation,
  at: string,
  appendEvent: Parameters<typeof recordDp>[4],
): void {
  if (r.heldUntil === undefined || r.heldUntil > at) r.heldUntil = at;
  for (const i of heldItems(draft, r)) {
    if (itemState(draft, i, r) !== "HELD") continue;
    appendEvent(draft, i.serial, {
      type: "RESERVASI_BATAL",
      toStatus: "TERSEDIA",
      refCode: r.code,
    });
  }
}

/** Can staff decide this DP now — refund or keep? */
export function canDecideDp(db: MockDb, r: Reservation): boolean {
  const stage = dpStage(db, r);
  return stage === "DECIDE" || stage === "HOLDING";
}

/**
 * Hand the DP back: a payment KELUAR naming the reservation, out of the pot
 * the staff member says it left from — by default the one it came into. The
 * hold closes, and anything it still held goes back on sale.
 */
export function refundDp(
  draft: MockDb,
  reservationId: string,
  input: { readonly id: string; readonly method: string; readonly at: string },
  appendEvent: Parameters<typeof recordDp>[4],
): boolean {
  const r = draft.reservations.find((x) => x.id === reservationId);
  if (r === undefined || r.dp === undefined || !canDecideDp(draft, r))
    return false;
  releaseHeld(draft, r, input.at, appendEvent);
  r.dp.refund = {
    id: input.id,
    method: input.method,
    amount: r.dp.amount,
    at: input.at,
  };
  r.status = "CANCELLED";
  return true;
}

/**
 * Keep the DP ("hangus"). Nothing new is written about the money — it came in
 * once and is already in the balance; the reservation closing with the DP
 * still on it IS the record, and Income & Expense reads it as *DP hangus*.
 */
export function keepDp(
  draft: MockDb,
  reservationId: string,
  at: string,
  appendEvent: Parameters<typeof recordDp>[4],
): boolean {
  const r = draft.reservations.find((x) => x.id === reservationId);
  if (r === undefined || r.dp === undefined || !canDecideDp(draft, r))
    return false;
  releaseHeld(draft, r, at, appendEvent);
  r.status = "CANCELLED";
  return true;
}

/**
 * The kept DPs, for Profit & Loss's other income: the money is the shop's
 * from the day the hold ended (`heldUntil`), which is when the customer
 * forfeited it — not the day it came in, when it was still theirs.
 */
export function keptDps(db: MockDb): {
  readonly reservation: Reservation;
  readonly amount: number;
  readonly at: string;
}[] {
  return db.reservations.flatMap((r) =>
    r.dp !== undefined && dpStage(db, r) === "KEPT"
      ? [
          {
            reservation: r,
            amount: r.dp.amount,
            at: r.heldUntil ?? r.dp.at,
          },
        ]
      : [],
  );
}
