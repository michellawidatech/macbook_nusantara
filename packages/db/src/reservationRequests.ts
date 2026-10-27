/**
 * Reservation REQUESTS — approved or rejected by a person (owner, 2026-10-27:
 * *"now the reservation has to be manually verified by humans, but I want to
 * make it easier for them"*).
 *
 * The bot files a request (`ReservationProposal`, `propose_reservation` in
 * packages/agent) and holds nothing. A person decides it here, from the
 * Requests tab on /reservations or the strip in /chat — both call the same
 * route, which calls these.
 *
 * **Approving is ONE transaction**: the `Reservation` (a staff one, so without
 * a DP it is the SOFT hold "Reserved for {name}, not paid" and its units stay
 * on sale), with a DP its `Payment` and a `DIRESERVASI` per unit and
 * `heldUntil` — exactly what `RecordDpModal` writes through the store — the
 * request linked (`reservationId`, `confirmedAt`), the thread's open booking /
 * closing / `Perlu verifikasi DP` tasks closed, the WhatsApp line queued, and
 * an audit row. Every till sees the result through `recordStoreChanges`.
 *
 * Rejecting stamps `cancelledAt`, closes the thread's booking task, and may
 * queue a line too. The reason is kept on the audit row — the proposal has no
 * column for it.
 *
 * Neither decides whether a WhatsApp line CAN be sent (the 24-hour window and
 * the transport are the route's — this package has no idea of either): it is
 * handed `tell` already decided.
 */
import { heldUntilOf, requestStatus, type DpRule } from "@nusantara/domain";
import { Prisma, type PrismaClient, type Tx } from "./client.js";
import { appendUnitEvent } from "./appendUnitEvent.js";
import {
  RequestNotFoundError,
  RequestSettledError,
  UnitNotAvailableError,
} from "./errors.js";
import { enqueueOutbox } from "./outbox.js";
import { reprojectHold } from "./reservations.js";
import { recordStoreChanges } from "./store/context.js";
import { withUnitLocks } from "./withUnitLocks.js";

/** The task a DP proof leaves (`dpVerifyTask` in packages/agent tasks.ts). */
export const DP_PROOF_PREFIX = "Perlu verifikasi DP";

export interface RequestTell {
  /** The customer's line, already composed. */
  readonly body: string;
  /** The customer's newest message, when there is one, for the thread. */
  readonly inReplyTo: string | null;
}

export interface ApproveRequestInput {
  readonly id: string;
  /** The units, as the person checked them; empty is a visit. */
  readonly serials: readonly string[];
  readonly scheduledFor: Date;
  readonly staffId: string;
  readonly at: Date;
  /** The DP received with it — makes the hold firm. */
  readonly dp?: {
    readonly amount: bigint;
    /** `PaymentMethod.code` — TRANSFER or TUNAI. */
    readonly method: string;
    readonly paidAt: Date;
  } | null;
  readonly rule: DpRule;
  readonly tell: RequestTell | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

export interface ApprovedRequest {
  readonly reservationId: string;
  readonly code: string;
  readonly heldUntil: Date | null;
  readonly serials: readonly string[];
  readonly told: boolean;
}

/** Lock the request and refuse unless it is still pending. */
async function lockPending(tx: Tx, id: string, now: Date) {
  const [row] = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "ReservationProposal" WHERE id = ${id} FOR UPDATE`,
  );
  if (!row) throw new RequestNotFoundError(id);
  const p = await tx.reservationProposal.findUniqueOrThrow({
    where: { id },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { unit: { select: { serial: true } } },
      },
    },
  });
  const replaced =
    p.cancelledAt !== null &&
    (await tx.reservationProposal.count({
      where: { from: p.from, createdAt: p.cancelledAt, id: { not: p.id } },
    })) > 0;
  const state = requestStatus(
    {
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      reservationId: p.reservationId,
      cancelledAt: p.cancelledAt?.toISOString() ?? null,
      replaced,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      unitCount: p.items.length,
    },
    now,
  );
  if (state !== "PENDING") throw new RequestSettledError(state);
  return p;
}

/** The thread's tasks a decision on a request settles. */
async function closeBookingTasks(
  tx: Tx,
  from: string,
  staffId: string,
  at: Date,
  withClosing: boolean,
): Promise<number> {
  const { count } = await tx.chatAction.updateMany({
    where: {
      from,
      status: "OPEN",
      OR: [
        { kind: "RESERVATION" },
        ...(withClosing
          ? [
              { kind: "CLOSING" as const },
              { summary: { startsWith: DP_PROOF_PREFIX } },
            ]
          : []),
      ],
    },
    data: {
      status: "DONE",
      resolvedAt: at,
      resolvedById: staffId,
      updatedAt: at,
    },
  });
  return count;
}

async function queueTell(
  tx: Tx,
  to: string,
  tell: RequestTell | null,
  requestId: string | null | undefined,
): Promise<boolean> {
  if (tell === null || tell.body.trim() === "") return false;
  await enqueueOutbox(tx, {
    kind: "WA_REPLY",
    payload: {
      to,
      body: tell.body.trim(),
      ...(tell.inReplyTo ? { inReplyTo: tell.inReplyTo } : {}),
    },
    requestId: requestId ?? null,
  });
  return true;
}

/**
 * Approve: book it.
 *
 * @throws RequestNotFoundError | RequestSettledError
 * @throws UnitNotAvailableError naming every unit that is no longer on sale
 */
export async function approveRequest(
  tx: Tx,
  input: ApproveRequestInput,
): Promise<ApprovedRequest> {
  const p = await lockPending(tx, input.id, input.at);
  const serials = [...new Set(input.serials.map((s) => s.trim()))]
    .filter(Boolean)
    .sort();

  // Units, ascending, in one statement — and every one still on sale.
  const locked = serials.length ? await withUnitLocks(tx, serials) : [];
  const gone = locked
    .filter((u) => u.status !== "TERSEDIA" || u.archivedAt !== null)
    .map((u) => ({ serial: u.serial, status: u.status, skuId: u.skuId }));
  if (gone.length > 0) throw new UnitNotAvailableError(gone);

  // The customer, create-only, as a hold made at the counter would.
  const phone = `+${p.from}`;
  const existing = await tx.customer.findFirst({
    where: { phone: { in: [p.from, phone] } },
    select: { id: true, name: true, phone: true },
  });
  const customer =
    existing ??
    (await tx.customer.create({
      data: { phone, name: p.custName, createdAt: input.at },
      select: { id: true, name: true, phone: true },
    }));
  if (!existing) await recordStoreChanges(tx, [["customers", customer.id]]);

  const heldUntil =
    input.dp && locked.length > 0
      ? heldUntilOf(input.dp.paidAt, input.rule.days)
      : null;
  const reservation = await tx.reservation.create({
    data: {
      customerId: customer.id,
      custName: customer.name || p.custName,
      phone: customer.phone,
      scheduledFor: input.scheduledFor,
      status: "TERJADWAL",
      // A person approved it, so it is a staff hold: without a DP it holds
      // nothing (`reprojectHold`'s SOFT reading), which is the rule.
      source: "STAF",
      note: "Dari chat — permintaan reservasi",
      createdAt: input.at,
      heldUntil,
      items: {
        create: locked
          .map((u) => ({ u, i: serials.indexOf(u.serial) }))
          .sort((a, b) => a.i - b.i)
          .map(({ u }, sortOrder) => ({
            skuId: u.skuId,
            unitId: u.id,
            qty: 1,
            sortOrder,
          })),
      },
    },
    select: { id: true, code: true },
  });
  await recordStoreChanges(tx, [["reservations", reservation.id]]);

  if (input.dp && locked.length > 0) {
    const method = await tx.paymentMethod.findFirst({
      where: { code: input.dp.method },
      select: { id: true },
    });
    if (!method) throw new RequestNotFoundError(input.dp.method);
    await tx.payment.create({
      data: {
        reservationId: reservation.id,
        direction: "MASUK",
        appliedTo: "BARANG",
        methodId: method.id,
        amount: input.dp.amount,
        status: "LUNAS",
        paidAt: input.dp.paidAt,
        recordedAt: input.dp.paidAt,
        staffId: input.staffId,
        sortOrder: 0,
      },
    });
    for (const u of locked) {
      await appendUnitEvent(tx, {
        serial: u.serial,
        type: "DIRESERVASI",
        staffId: input.staffId,
        at: input.at,
        reservationId: reservation.id,
        requestId: input.requestId ?? null,
        note: `DP reservasi ${reservation.code}`,
      });
    }
  }
  if (locked.length > 0) await reprojectHold(tx, reservation.id);

  const { count } = await tx.reservationProposal.updateMany({
    where: { id: p.id, confirmedAt: null, cancelledAt: null },
    data: { confirmedAt: input.at, reservationId: reservation.id },
  });
  if (count !== 1) throw new RequestSettledError("APPROVED");
  await recordStoreChanges(tx, [["reservationRequests", p.id]]);

  await closeBookingTasks(tx, p.from, input.staffId, input.at, true);
  const told = await queueTell(tx, p.from, input.tell, input.requestId);

  await tx.auditLog.create({
    data: {
      at: input.at,
      staffId: input.staffId,
      entity: "ReservationProposal",
      entityId: p.id,
      action: "UPDATE",
      field: "confirmedAt",
      before: null,
      after: JSON.stringify({
        reservation: reservation.code,
        serials: locked.map((u) => u.serial),
        scheduledFor: input.scheduledFor.toISOString(),
        dp: input.dp ? input.dp.amount.toString() : null,
        told,
      }),
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
    },
  });

  return {
    reservationId: reservation.id,
    code: reservation.code,
    heldUntil,
    serials: locked.map((u) => u.serial),
    told,
  };
}

export interface RejectRequestInput {
  readonly id: string;
  readonly reason: string;
  readonly staffId: string;
  readonly at: Date;
  readonly tell: RequestTell | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

/**
 * Reject: `cancelledAt`, the thread's booking task closed, and maybe a line.
 *
 * @throws RequestNotFoundError | RequestSettledError
 */
export async function rejectRequest(
  tx: Tx,
  input: RejectRequestInput,
): Promise<{ readonly told: boolean }> {
  const p = await lockPending(tx, input.id, input.at);
  await tx.reservationProposal.update({
    where: { id: p.id },
    data: { cancelledAt: input.at },
  });
  await recordStoreChanges(tx, [["reservationRequests", p.id]]);
  await closeBookingTasks(tx, p.from, input.staffId, input.at, false);
  const told = await queueTell(tx, p.from, input.tell, input.requestId);
  await tx.auditLog.create({
    data: {
      at: input.at,
      staffId: input.staffId,
      entity: "ReservationProposal",
      entityId: p.id,
      action: "UPDATE",
      field: "cancelledAt",
      before: null,
      after: JSON.stringify({ reason: input.reason, told }),
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
    },
  });
  return { told };
}

/** A request, with what the dialogs need to show it. */
export async function getRequest(db: PrismaClient | Tx, id: string) {
  const p = await db.reservationProposal.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          unit: {
            select: {
              serial: true,
              sku: { select: { name: true, variantLabel: true } },
            },
          },
        },
      },
    },
  });
  if (!p) throw new RequestNotFoundError(id);
  return p;
}
