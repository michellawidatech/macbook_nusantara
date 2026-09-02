/**
 * Inbound & QC, as business functions rather than screen handlers.
 *
 * These are the writes `apps/web`'s Inbound & QC screen has been making to the
 * browser mock, moved to where the database is. The point of putting them here
 * rather than in the route is the one the reservations slice already made: one
 * business function serves the REST route and the AI worker, and release logic
 * that exists three times is three copies that disagree about concurrency.
 *
 * ## The two writes, and why they are two
 *
 * A machine reaches the shelf in two separate acts, and conflating them is the
 * bug the QC grid was rebuilt to remove (`lib/inboundQc.ts`, owner decision
 * 2026-08-26):
 *
 *   1. **{@link receiveUnit}** — somebody read a serial off the case. THAT is
 *      when the unit comes into existence. Before it, the invoice says a
 *      machine is here and nobody has identified it; that is a slot, it lives
 *      in the page, and it is not a row. A unit minted before its serial is a
 *      unit that is not about any machine.
 *   2. **{@link acceptUnits}** — QC is satisfied and the machine is sellable.
 *
 * ## Why the status is never passed in
 *
 * `appendUnitEvent` derives it: the unit's current status comes from the
 * LEDGER, not from `Unit.status`, which is a projection and therefore a cache.
 * A unit with no events has not arrived, so `from` is null and `DITERIMA` is
 * the genesis that puts it in QC. Nothing here says "set the status to QC" —
 * it says what happened, and the status follows. That is invariant 1.
 */

import type { Grade } from "../generated/client/index.js";
import type { Tx } from "./client.js";
import { appendUnitEvent } from "./appendUnitEvent.js";

export interface ReceiveUnitInput {
  /** Apple's own barcode, already validated by the caller (lib/serialScan.ts). */
  readonly serial: string;
  readonly skuId: string;
  /** What this machine cost, and what it cost landed. Per-serial facts. */
  readonly buy: bigint;
  readonly landed: bigint;
  /** Where it physically is. QC is a status, not a place. */
  readonly locationId: string;
  readonly staffId: string;
  /** The invoice line it came in on, when it came in on one. */
  readonly poItemId?: string | null;
  /** The invoice, recorded on the event so the timeline can join back to it. */
  readonly purchaseOrderId?: string | null;
  readonly requestId?: string | null;
}

export interface AcceptUnitInput {
  readonly serial: string;
  /**
   * Computed by the grading checklist and always overridable, or `NEW` for
   * sealed stock. Optional because the grade never gates acceptance — the
   * description does (owner decision 2026-08-27).
   */
  readonly grade?: Grade | null;
  /**
   * What QC saw. Required for a second-hand machine and meaningless for a
   * sealed one, and that rule is the CALLER's: `lib/inboundQc.ts` refuses the
   * row and can say why. Here it is simply recorded.
   */
  readonly description?: string | null;
}

export interface AcceptUnitsInput {
  readonly units: readonly AcceptUnitInput[];
  readonly staffId: string;
  readonly purchaseOrderId?: string | null;
  /** The invoice's own code, so the ledger row reads like the paperwork. */
  readonly refCode?: string | null;
  readonly requestId?: string | null;
}

/**
 * A serial comes into existence, in QC.
 *
 * One transaction: the `Unit` row and its genesis `DITERIMA` event, because a
 * unit that exists without the event that created it is a hole in an
 * append-only ledger — and the projection is written by the same call that
 * writes the event, which is invariant 1.
 *
 * `status` is passed as QC on the create even though the event immediately
 * derives the same value. Not redundant: `Unit.status` is NOT NULL, so the row
 * needs a value to exist at all, and seeding it with the answer the ledger is
 * about to give is honest in a way that picking an arbitrary one would not be.
 */
export async function receiveUnit(
  tx: Tx,
  input: ReceiveUnitInput,
): Promise<{ id: string; serial: string }> {
  const unit = await tx.unit.create({
    data: {
      serial: input.serial,
      skuId: input.skuId,
      status: "QC",
      locationId: input.locationId,
      buy: input.buy,
      landed: input.landed,
      ...(input.poItemId == null ? {} : { poItemId: input.poItemId }),
      intakeAt: new Date(),
      // 1, not 0: `Unit_version_positive_check` requires it. The optimistic
      // lock counts versions of the row, and a row that exists has had one.
      version: 1,
    },
    select: { id: true, serial: true },
  });

  await appendUnitEvent(tx, {
    serial: input.serial,
    type: "DITERIMA",
    staffId: input.staffId,
    toLocationId: input.locationId,
    costDelta: input.landed,
    ...(input.purchaseOrderId == null
      ? {}
      : { purchaseOrderId: input.purchaseOrderId }),
    ...(input.requestId == null ? {} : { requestId: input.requestId }),
  });

  return unit;
}

/**
 * QC is satisfied: the machines become sellable stock.
 *
 * All of them in ONE transaction, because *Accept all* is a single press and a
 * half-accepted invoice is a worse state than a refused one — the operator
 * would have to work out which rows went through by reading the grid.
 *
 * The caller decides what is acceptable. `qcReady` in `lib/inboundQc.ts` is
 * what excludes a row still owing a description, and it stays there because it
 * has to explain itself to somebody looking at the grid. Passing a serial here
 * asserts that decision has been made.
 *
 * Grade and description are written to the `Unit` row rather than the event,
 * and that is not a shortcut: the ledger records that QC finished, and what QC
 * CONCLUDED is a fact about the machine, which is where every screen reads it.
 */
export async function acceptUnits(
  tx: Tx,
  input: AcceptUnitsInput,
): Promise<{ accepted: number }> {
  if (input.units.length === 0) return { accepted: 0 };

  for (const u of input.units) {
    // The conclusion first, so the projection the event writes lands on a
    // row that already carries the grade it was graded at. Both are in one
    // transaction, so no reader ever sees one without the other.
    if (u.grade !== undefined || u.description !== undefined) {
      await tx.unit.update({
        where: { serial: u.serial },
        data: {
          ...(u.grade === undefined ? {} : { grade: u.grade }),
          ...(u.description === undefined
            ? {}
            : { description: u.description }),
        },
      });
    }

    await appendUnitEvent(tx, {
      serial: u.serial,
      type: "QC_SELESAI",
      staffId: input.staffId,
      ...(input.purchaseOrderId == null
        ? {}
        : { purchaseOrderId: input.purchaseOrderId }),
      ...(input.requestId == null ? {} : { requestId: input.requestId }),
      note:
        input.refCode == null ? "QC passed" : `QC passed — ${input.refCode}`,
    });
  }

  return { accepted: input.units.length };
}
