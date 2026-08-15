/**
 * Ordered row locking — docs/rebuild/08-data-integrity.md §3.
 *
 * "Always lock units in ascending serial order. Two cashiers scanning the same
 * two devices in opposite orders is a real deadlock, and ordering is the whole
 * fix."
 *
 * Ordering is the fix, not the retry. A retry loop turns a deadlock into a
 * slow success and hides the bug; ordering means the deadlock never forms.
 */

import { Prisma, type Tx } from "./client.js";
import type { UnitStatus } from "@nusantara/domain";

export interface LockedUnit {
  readonly id: string;
  readonly serial: string;
  readonly status: UnitStatus;
  readonly locationId: string;
  readonly skuId: string;
  readonly version: number;
  readonly archivedAt: Date | null;
}

/** Thrown when a scanned serial is not in the database at all. */
export class UnknownSerialError extends Error {
  readonly serials: readonly string[];

  constructor(serials: readonly string[]) {
    super(`Serial tidak ditemukan: ${serials.join(", ")}`);
    this.name = "UnknownSerialError";
    this.serials = serials;
  }
}

/**
 * Lock every named unit `FOR UPDATE`, in ascending serial order, and return
 * them in that same order.
 *
 * Duplicates in the input are collapsed — scanning the same device twice is a
 * cashier's slip, not a request for two locks.
 *
 * @throws UnknownSerialError naming every serial that does not exist, so the
 *         cashier is told which device is the problem rather than "not found".
 */
export async function withUnitLocks(
  tx: Tx,
  serials: readonly string[],
): Promise<LockedUnit[]> {
  const ordered = [...new Set(serials)].sort();
  if (ordered.length === 0) return [];

  // One statement, ORDER BY serial: Postgres locks at the LockRows node, which
  // sits above the sort, so rows are locked in ascending serial order.
  const rows = await tx.$queryRaw<LockedUnit[]>(Prisma.sql`
    SELECT id, serial, status, "locationId", "skuId", version, "archivedAt"
      FROM "Unit"
     WHERE serial IN (${Prisma.join(ordered)})
     ORDER BY serial
       FOR UPDATE
  `);

  if (rows.length !== ordered.length) {
    const found = new Set(rows.map((r) => r.serial));
    throw new UnknownSerialError(ordered.filter((s) => !found.has(s)));
  }

  return rows;
}
