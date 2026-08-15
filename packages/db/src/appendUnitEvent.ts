/**
 * The one write that matters — docs/rebuild/08-data-integrity.md §1 and §4.
 *
 * "Every state change of a unit is an event row, never an in-place update
 * alone. Unit.status and Unit.locationId are projections of that event stream,
 * written in the same transaction as the event."
 *
 * Nothing else in this codebase may update Unit.status. This function appends
 * the event and writes the projection together, or does neither.
 */

import {
  assertTransition,
  type ClaimResolution,
  type UnitEventType,
} from "@nusantara/domain";
import { Prisma, type Tx } from "./client.js";
import { withUnitLocks } from "./withUnitLocks.js";

export interface AppendUnitEventInput {
  /** The subject of this database (08 §1). Events are addressed by serial. */
  readonly serial: string;
  readonly type: UnitEventType;
  readonly staffId: string;
  readonly at?: Date;
  /** Set only when the unit actually moves; null means "did not move". */
  readonly toLocationId?: string | null;
  /** Required by KLAIM_SELESAI, ignored otherwise. */
  readonly resolution?: ClaimResolution;
  readonly orderId?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly claimId?: string | null;
  readonly opnameSessionId?: string | null;
  readonly costDelta?: bigint;
  readonly requestId?: string | null;
  readonly note?: string | null;
}

export interface AppendedUnitEvent {
  readonly id: string;
  readonly unitId: string;
  readonly serial: string;
  readonly seq: number;
  readonly toStatus: string;
  readonly toLocationId: string | null;
}

/**
 * Append one event and project it, inside the caller's transaction.
 *
 * `seq` is `MAX(seq) + 1` for this unit, read **under the unit's row lock** —
 * that is what makes the ledger gapless without a global sequence (08 §4). The
 * unique index on (unitId, seq) is the backstop if the lock is ever bypassed.
 *
 * @throws IllegalUnitTransitionError naming the serial and its current status.
 */
export async function appendUnitEvent(
  tx: Tx,
  input: AppendUnitEventInput,
): Promise<AppendedUnitEvent> {
  const [unit] = await withUnitLocks(tx, [input.serial]);
  if (unit === undefined) {
    // withUnitLocks throws UnknownSerialError first; this is for the type.
    throw new Error(`Serial tidak ditemukan: ${input.serial}`);
  }

  // The unit's current status comes from the ledger, not from Unit.status.
  // Unit.status is a projection — a cache (08 §1) — and a cache that has
  // drifted must not be able to authorise a transition the history forbids.
  // No events yet means the unit has not arrived: `from` is null, and DITERIMA
  // is the only legal arrow in.
  //
  // Read under the row lock taken above, so no other transaction can be
  // choosing the same seq for this unit. That is what makes the ledger gapless
  // without a global sequence (08 §4).
  const [last] = await tx.$queryRaw<
    { seq: number; toStatus: string }[]
  >(Prisma.sql`
    SELECT seq, "toStatus"
      FROM "UnitEvent"
     WHERE "unitId" = ${unit.id}
     ORDER BY seq DESC
     LIMIT 1
  `);

  const from = (last?.toStatus ?? null) as Parameters<
    typeof assertTransition
  >[1];
  const seq = Number(last?.seq ?? 0) + 1;

  // Rejects by name before anything is written.
  const toStatus = assertTransition(
    unit.serial,
    from,
    input.type,
    input.resolution,
  );

  const moved =
    input.toLocationId != null && input.toLocationId !== unit.locationId;
  const toLocationId = input.toLocationId ?? null;

  const event = await tx.unitEvent.create({
    data: {
      unitId: unit.id,
      // An immutable copy, so history reads correctly even if the Unit row is
      // later archived or repaired (08 §4).
      serial: unit.serial,
      seq,
      type: input.type,
      at: input.at ?? new Date(),
      fromStatus: from,
      toStatus,
      fromLocationId: toLocationId === null ? null : unit.locationId,
      toLocationId,
      orderId: input.orderId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      claimId: input.claimId ?? null,
      opnameSessionId: input.opnameSessionId ?? null,
      costDelta: input.costDelta ?? 0n,
      staffId: input.staffId,
      requestId: input.requestId ?? null,
      note: input.note ?? null,
    },
    select: { id: true },
  });

  // The projection, in the same transaction as the event that justifies it.
  await tx.unit.update({
    where: { id: unit.id },
    data: {
      status: toStatus,
      ...(moved ? { locationId: input.toLocationId as string } : {}),
      version: { increment: 1 },
    },
  });

  return {
    id: event.id,
    unitId: unit.id,
    serial: unit.serial,
    seq,
    toStatus,
    toLocationId,
  };
}
