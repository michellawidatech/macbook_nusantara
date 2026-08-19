/**
 * Running the reconciliation checks against a real database.
 *
 * 08 §6: "Each check is a function in `packages/domain`, called by a script
 * *and* by a test with a deliberately corrupted fixture." This is the bridge —
 * it loads the plain rows the pure checks expect and nothing more.
 *
 * It never fixes anything. §6: "Report; never auto-fix silently."
 */

import { type CheckReport, isClean, runAllChecks } from "@nusantara/domain";
import type { PrismaClient } from "./client.js";

export { isClean };
export type { CheckReport };

export async function reconcile(db: PrismaClient): Promise<CheckReport[]> {
  const [units, events, orders, orderItems, payments, shifts] =
    await Promise.all([
      db.unit.findMany({
        select: { id: true, serial: true, status: true, locationId: true },
      }),
      db.unitEvent.findMany({
        select: {
          unitId: true,
          seq: true,
          type: true,
          toStatus: true,
          toLocationId: true,
        },
      }),
      db.order.findMany({
        select: {
          id: true,
          code: true,
          subtotal: true,
          discount: true,
          extra: true,
          total: true,
          paidTotal: true,
        },
      }),
      db.orderItem.findMany({
        select: {
          id: true,
          orderId: true,
          unitId: true,
          sub: true,
          returnedAt: true,
        },
      }),
      db.payment.findMany({
        select: {
          orderId: true,
          shiftId: true,
          amount: true,
          status: true,
          method: true,
          direction: true,
        },
      }),
      db.shift.findMany({
        select: { id: true, openFloat: true, expected: true },
      }),
    ]);

  return runAllChecks({ units, events, orders, orderItems, payments, shifts });
}

/** A short human summary, for the script and for a failing test's message. */
export function formatReports(reports: readonly CheckReport[]): string {
  return reports
    .map((r) => {
      const head = `${r.findings.length === 0 ? "OK  " : "GAGAL"} ${r.name} (${r.severity}) — ${r.findings.length} temuan`;
      const detail = r.findings
        .slice(0, 5)
        .map((f) => `\n        ${f.subject}: ${f.detail}`)
        .join("");
      return head + detail;
    })
    .join("\n");
}
