/**
 * The bot's reservation REQUESTS, as the Requests tab on /reservations and
 * the strip in /chat read them (owner, 2026-10-27: *"they can either approve
 * the chat and add it to the reservation list, or we can see the list of who
 * wants to reserve, the unit, the time, and the pending status which they can
 * then approve"*).
 *
 * The rows come from the store (`db.reservationRequests`, read-only); the two
 * decisions go to `/api/reservations/requests`, which books the reservation,
 * the DP, the task close and the WhatsApp line in ONE transaction — then the
 * store's change feed brings the result to every till. No idempotency key:
 * the server locks the request and refuses a second decision (409), and a
 * retry after a refusal carries a different body by design.
 */
import {
  compareRequests,
  requestStatus,
  requestWaiting,
  type RequestFacts,
  type RequestStatus,
  type RequestWaiting,
} from "@nusantara/domain";
import type { MockDb, ReservationRequest, Unit } from "../mock/seed.js";
import { api } from "./api.js";

export interface RequestUnit {
  readonly serial: string;
  /** "MacBook Air M2 8/256", or the serial when the unit is unknown here. */
  readonly name: string;
  readonly grade: string | null;
  /** The unit's status now — a unit sold since cannot be approved. */
  readonly status: Unit["status"] | null;
}

export interface RequestRow {
  readonly request: ReservationRequest;
  readonly status: RequestStatus;
  /** What a PENDING request is waiting for. */
  readonly waiting: RequestWaiting;
  readonly units: readonly RequestUnit[];
}

const factsOf = (r: ReservationRequest): RequestFacts => ({
  confirmedAt: r.confirmedAt ?? null,
  reservationId: r.reservationId ?? null,
  cancelledAt: r.cancelledAt ?? null,
  replaced: r.replaced,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  unitCount: r.items.length,
  dpProofAt: r.dpProofAt ?? null,
});

/** A unit as a request names it. */
export function unitName(db: MockDb, serial: string): RequestUnit {
  const unit = db.units.find((u) => u.serial === serial);
  const sku = unit ? db.skus.find((s) => s.id === unit.skuId) : undefined;
  const name = sku
    ? [sku.name, sku.variantLabel].filter(Boolean).join(" ")
    : serial;
  return {
    serial,
    name,
    grade: unit?.grade ?? null,
    status: unit?.status ?? null,
  };
}

export function requestRow(
  db: MockDb,
  r: ReservationRequest,
  now: Date,
): RequestRow {
  const facts = factsOf(r);
  return {
    request: r,
    status: requestStatus(facts, now),
    waiting: requestWaiting(facts),
    units: r.items.map((i) => unitName(db, i.serial)),
  };
}

/**
 * The Requests tab: oldest pending first, the decided ones newest first, the
 * lapsed at the bottom. A request the customer replaced with a newer one is
 * left out — the newer one is the same customer asking again.
 */
export function requestRows(db: MockDb, now: Date): RequestRow[] {
  return [...db.reservationRequests]
    .sort((a, b) => compareRequests(factsOf(a), factsOf(b), now))
    .map((r) => requestRow(db, r, now))
    .filter((row) => row.status !== "REPLACED");
}

/** How many wait on a person — the tab's and the nav leaf's badge. */
export function pendingRequestCount(db: MockDb, now: Date): number {
  return db.reservationRequests.filter(
    (r) => requestStatus(factsOf(r), now) === "PENDING",
  ).length;
}

/** The thread's waiting request, for the strip in /chat. */
export function pendingRequestFor(
  db: MockDb,
  phone: string,
  now: Date,
): RequestRow | undefined {
  const r = db.reservationRequests
    .filter(
      (x) => x.phone === phone && requestStatus(factsOf(x), now) === "PENDING",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return r ? requestRow(db, r, now) : undefined;
}

// --- the two decisions -------------------------------------------------------

export interface ApproveBody {
  readonly serials: readonly string[];
  /** ISO. */
  readonly scheduledFor: string;
  readonly dp?: {
    /** Whole rupiah, as a string (money never travels as a number). */
    readonly amount: string;
    readonly method: "TRANSFER" | "TUNAI";
    /** ISO. */
    readonly paidAt: string;
  } | null;
  readonly tell: boolean;
  readonly message?: string;
}

export interface Decided {
  /** The line was queued for WhatsApp. */
  readonly told: boolean;
  /** It was asked for, and the 24-hour window would have refused it. */
  readonly windowClosed: boolean;
}

export interface Approved extends Decided {
  readonly reservation: { readonly id: string; readonly code: string };
  readonly heldUntil: string | null;
}

export const approveRequest = (id: string, body: ApproveBody) =>
  api<Approved>(
    `/api/reservations/requests/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      body,
    },
  );

export const rejectRequest = (
  id: string,
  body: {
    readonly reason: string;
    readonly tell: boolean;
    readonly message?: string;
  },
) =>
  api<Decided>(`/api/reservations/requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body,
  });
