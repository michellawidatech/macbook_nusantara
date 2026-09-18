/**
 * The eight reconciliation checks — docs/rebuild/08-data-integrity.md §6.
 *
 * "Projections drift. Assume it and check for it." Each function is pure and
 * takes plain data, so the same code runs from the nightly script, from the
 * Monitor app, and from a test with a deliberately corrupted fixture.
 *
 * Nothing here fixes anything. §6: "Report; never auto-fix silently."
 */

import type { UnitEventType, UnitStatus } from "./unitState.js";

export type Severity = "ALERT" | "REPORT";

export type CheckName =
  | "PROYEKSI_STATUS"
  | "PROYEKSI_LOKASI"
  | "KONTINUITAS_LEDGER"
  | "ARITMATIKA_ORDER"
  | "CAKUPAN_PEMBAYARAN"
  | "UNIT_YATIM"
  | "TERJUAL_GANDA"
  | "KAS_SHIFT";

/** One thing that is wrong, named by the row it is wrong about. */
export interface Finding {
  /** The serial, order code or shift id — whatever a human would search for. */
  readonly subject: string;
  readonly detail: string;
}

export interface CheckReport {
  readonly name: CheckName;
  readonly severity: Severity;
  readonly findings: readonly Finding[];
}

// --- the shapes these checks read ------------------------------------------
// Deliberately plain: no Prisma types, so packages/domain stays independent.

export interface UnitRow {
  readonly id: string;
  readonly serial: string;
  readonly status: UnitStatus;
  readonly locationId: string;
}

export interface UnitEventRow {
  readonly unitId: string;
  readonly seq: number;
  readonly type: UnitEventType;
  readonly toStatus: UnitStatus;
  readonly toLocationId: string | null;
}

export interface OrderRow {
  readonly id: string;
  readonly code: string;
  readonly subtotal: bigint;
  readonly discount: bigint;
  readonly extra: bigint;
  readonly total: bigint;
  readonly paidTotal: bigint;
}

export interface OrderItemRow {
  readonly id: string;
  readonly orderId: string;
  readonly unitId: string | null;
  readonly sub: bigint;
  readonly returnedAt: Date | null;
}

export interface PaymentRow {
  readonly orderId: string | null;
  readonly shiftId: string | null;
  readonly amount: bigint;
  readonly status: string;
  readonly method: string;
  readonly direction: string;
}

export interface ShiftRow {
  readonly id: string;
  readonly openFloat: bigint;
  readonly expected: bigint;
}

function report(
  name: CheckName,
  severity: Severity,
  findings: Finding[],
): CheckReport {
  return { name, severity, findings };
}

/** The unit's last event, by seq. Undefined when it has no events at all. */
function latestEventByUnit(
  events: readonly UnitEventRow[],
): Map<string, UnitEventRow> {
  const out = new Map<string, UnitEventRow>();
  for (const e of events) {
    const prev = out.get(e.unitId);
    if (prev === undefined || e.seq > prev.seq) out.set(e.unitId, e);
  }
  return out;
}

/** 1. `Unit.status` vs the `toStatus` of its highest-`seq` event. */
export function checkStatusProjection(
  units: readonly UnitRow[],
  events: readonly UnitEventRow[],
): CheckReport {
  const latest = latestEventByUnit(events);
  const findings: Finding[] = [];

  for (const u of units) {
    const e = latest.get(u.id);
    if (e === undefined) continue; // no history — that is check 6's business
    if (e.toStatus !== u.status) {
      findings.push({
        subject: u.serial,
        detail: `status ${u.status} tapi event terakhir (seq ${e.seq}) berakhir di ${e.toStatus}`,
      });
    }
  }
  return report("PROYEKSI_STATUS", "REPORT", findings);
}

/** 2. `Unit.locationId` vs the latest `toLocationId`. */
export function checkLocationProjection(
  units: readonly UnitRow[],
  events: readonly UnitEventRow[],
): CheckReport {
  const latest = new Map<string, UnitEventRow>();
  for (const e of events) {
    if (e.toLocationId === null) continue; // this event did not move the unit
    const prev = latest.get(e.unitId);
    if (prev === undefined || e.seq > prev.seq) latest.set(e.unitId, e);
  }

  const findings: Finding[] = [];
  for (const u of units) {
    const e = latest.get(u.id);
    if (e === undefined) continue;
    if (e.toLocationId !== u.locationId) {
      findings.push({
        subject: u.serial,
        detail: `lokasi ${u.locationId} tapi perpindahan terakhir (seq ${e.seq}) ke ${e.toLocationId}`,
      });
    }
  }
  return report("PROYEKSI_LOKASI", "REPORT", findings);
}

/**
 * 3. `seq` sequences with a gap or a duplicate.
 *
 * §6 marks this ALERT: a gap means the transaction that appends events has a
 * bug, which is worse than any single wrong row.
 */
export function checkLedgerContinuity(
  events: readonly UnitEventRow[],
  serialByUnitId: ReadonlyMap<string, string> = new Map(),
): CheckReport {
  const byUnit = new Map<string, number[]>();
  for (const e of events) {
    const list = byUnit.get(e.unitId);
    if (list === undefined) byUnit.set(e.unitId, [e.seq]);
    else list.push(e.seq);
  }

  const findings: Finding[] = [];
  for (const [unitId, seqs] of byUnit) {
    const subject = serialByUnitId.get(unitId) ?? unitId;
    const sorted = [...seqs].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length; i += 1) {
      const expected = i + 1;
      if (sorted[i] === expected) continue;
      findings.push({
        subject,
        detail:
          sorted[i] === sorted[i - 1]
            ? `seq ${sorted[i]} muncul dua kali`
            : `seq melompat: menunggu ${expected}, menemukan ${sorted[i]}`,
      });
      break; // one finding per unit; the first break is the one to investigate
    }
  }
  return report("KONTINUITAS_LEDGER", "ALERT", findings);
}

/** 4. `Order.total` vs Σ`OrderItem.sub` − discount + extra. */
export function checkOrderArithmetic(
  orders: readonly OrderRow[],
  items: readonly OrderItemRow[],
): CheckReport {
  const subs = new Map<string, bigint>();
  for (const it of items) {
    subs.set(it.orderId, (subs.get(it.orderId) ?? 0n) + it.sub);
  }

  const findings: Finding[] = [];
  for (const o of orders) {
    const sum = subs.get(o.id) ?? 0n;
    const expected = sum - o.discount + o.extra;
    if (expected !== o.total) {
      findings.push({
        subject: o.code,
        detail: `total ${o.total} tapi Σbaris ${sum} − diskon ${o.discount} + ekstra ${o.extra} = ${expected}`,
      });
    }
  }
  return report("ARITMATIKA_ORDER", "ALERT", findings);
}

/** 5. `Order.paidTotal` vs Σ`Payment.amount` where `status = LUNAS`. */
export function checkPaymentCoverage(
  orders: readonly OrderRow[],
  payments: readonly PaymentRow[],
): CheckReport {
  const paid = new Map<string, bigint>();
  for (const p of payments) {
    if (p.orderId === null) continue;
    if (p.status !== "LUNAS") continue;
    const signed = p.direction === "KELUAR" ? -p.amount : p.amount;
    paid.set(p.orderId, (paid.get(p.orderId) ?? 0n) + signed);
  }

  const findings: Finding[] = [];
  for (const o of orders) {
    const sum = paid.get(o.id) ?? 0n;
    if (sum !== o.paidTotal) {
      findings.push({
        subject: o.code,
        detail: `paidTotal ${o.paidTotal} tapi Σpembayaran LUNAS = ${sum}`,
      });
    }
  }
  return report("CAKUPAN_PEMBAYARAN", "ALERT", findings);
}

/**
 * 6. `Unit` with no arrival event. §6 expects only migrated rows here.
 *
 * An arrival is either genesis arrow in `unitState.ts`: `DITERIMA` off a
 * purchase, or `OPNAME_DITEMUKAN` for a machine a stock take found with no
 * paperwork (2026-08-31). Counting only the first reported every unit taken in
 * at a count — and the B2Soft import's machines sold with no purchase invoice,
 * which arrive the same way (2026-09-13).
 */
export function checkOrphanUnits(
  units: readonly UnitRow[],
  events: readonly UnitEventRow[],
): CheckReport {
  const received = new Set<string>();
  for (const e of events) {
    if (e.type === "DITERIMA" || e.type === "OPNAME_DITEMUKAN") {
      received.add(e.unitId);
    }
  }

  const findings: Finding[] = [];
  for (const u of units) {
    if (!received.has(u.id)) {
      findings.push({
        subject: u.serial,
        detail: "tidak punya event kedatangan (DITERIMA atau OPNAME_DITEMUKAN)",
      });
    }
  }
  return report("UNIT_YATIM", "REPORT", findings);
}

/**
 * 7. A unit on more than one un-returned `OrderItem`.
 *
 * §6: "Alert — invariant 3 should make this impossible." If this ever fires,
 * the partial unique index is missing rather than merely violated.
 */
export function checkSoldTwice(
  items: readonly OrderItemRow[],
  serialByUnitId: ReadonlyMap<string, string> = new Map(),
): CheckReport {
  const open = new Map<string, string[]>();
  for (const it of items) {
    if (it.unitId === null) continue;
    if (it.returnedAt !== null) continue;
    const list = open.get(it.unitId);
    if (list === undefined) open.set(it.unitId, [it.orderId]);
    else list.push(it.orderId);
  }

  const findings: Finding[] = [];
  for (const [unitId, orderIds] of open) {
    if (orderIds.length > 1) {
      findings.push({
        subject: serialByUnitId.get(unitId) ?? unitId,
        detail: `terjual di ${orderIds.length} order sekaligus: ${orderIds.join(", ")}`,
      });
    }
  }
  return report("TERJUAL_GANDA", "ALERT", findings);
}

/**
 * 8. `Shift.expected` vs the cash that passed through it.
 *
 * Expected cash is the opening float plus cash in, minus cash out. §6 says
 * only "Σ cash Payment in its window"; the float is included because a till
 * that started with money and is compared without it is always wrong.
 */
export function checkShiftCash(
  shifts: readonly ShiftRow[],
  payments: readonly PaymentRow[],
): CheckReport {
  const net = new Map<string, bigint>();
  for (const p of payments) {
    if (p.shiftId === null) continue;
    if (p.method !== "TUNAI") continue;
    if (p.status !== "LUNAS") continue;
    const signed = p.direction === "KELUAR" ? -p.amount : p.amount;
    net.set(p.shiftId, (net.get(p.shiftId) ?? 0n) + signed);
  }

  const findings: Finding[] = [];
  for (const s of shifts) {
    const cash = net.get(s.id) ?? 0n;
    const expected = s.openFloat + cash;
    if (expected !== s.expected) {
      findings.push({
        subject: s.id,
        detail: `expected ${s.expected} tapi float ${s.openFloat} + kas bersih ${cash} = ${expected}`,
      });
    }
  }
  return report("KAS_SHIFT", "REPORT", findings);
}

export interface ReconciliationInput {
  readonly units: readonly UnitRow[];
  readonly events: readonly UnitEventRow[];
  readonly orders: readonly OrderRow[];
  readonly orderItems: readonly OrderItemRow[];
  readonly payments: readonly PaymentRow[];
  readonly shifts: readonly ShiftRow[];
}

/** All eight, in §6's order. */
export function runAllChecks(input: ReconciliationInput): CheckReport[] {
  const serials = new Map<string, string>();
  for (const u of input.units) serials.set(u.id, u.serial);

  return [
    checkStatusProjection(input.units, input.events),
    checkLocationProjection(input.units, input.events),
    checkLedgerContinuity(input.events, serials),
    checkOrderArithmetic(input.orders, input.orderItems),
    checkPaymentCoverage(input.orders, input.payments),
    checkOrphanUnits(input.units, input.events),
    checkSoldTwice(input.orderItems, serials),
    checkShiftCash(input.shifts, input.payments),
  ];
}

/** True when nothing at all is wrong. */
export function isClean(reports: readonly CheckReport[]): boolean {
  return reports.every((r) => r.findings.length === 0);
}
