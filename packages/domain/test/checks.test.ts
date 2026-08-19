import { describe, expect, it } from "vitest";
import {
  type OrderItemRow,
  type OrderRow,
  type PaymentRow,
  type ShiftRow,
  type UnitEventRow,
  type UnitRow,
  checkLedgerContinuity,
  checkLocationProjection,
  checkOrderArithmetic,
  checkOrphanUnits,
  checkPaymentCoverage,
  checkShiftCash,
  checkSoldTwice,
  checkStatusProjection,
  isClean,
  runAllChecks,
} from "../src/checks.js";

const unit = (over: Partial<UnitRow> = {}): UnitRow => ({
  id: "u1",
  serial: "SER-001",
  status: "TERSEDIA",
  locationId: "loc1",
  ...over,
});

const event = (over: Partial<UnitEventRow> = {}): UnitEventRow => ({
  unitId: "u1",
  seq: 1,
  type: "DITERIMA",
  toStatus: "TERSEDIA",
  toLocationId: "loc1",
  ...over,
});

const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: "o1",
  code: "SI-2026/07-000001",
  subtotal: 100n,
  discount: 0n,
  extra: 0n,
  total: 100n,
  paidTotal: 100n,
  ...over,
});

const item = (over: Partial<OrderItemRow> = {}): OrderItemRow => ({
  id: "i1",
  orderId: "o1",
  unitId: "u1",
  sub: 100n,
  returnedAt: null,
  ...over,
});

const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  orderId: "o1",
  shiftId: "s1",
  amount: 100n,
  status: "LUNAS",
  method: "TUNAI",
  direction: "MASUK",
  ...over,
});

const shift = (over: Partial<ShiftRow> = {}): ShiftRow => ({
  id: "s1",
  openFloat: 0n,
  expected: 100n,
  ...over,
});

describe("08 §6 — 1. status projection", () => {
  it("passes when the projection matches the last event", () => {
    const r = checkStatusProjection(
      [unit({ status: "TERJUAL" })],
      [
        event({ seq: 1 }),
        event({ seq: 2, type: "TERJUAL", toStatus: "TERJUAL" }),
      ],
    );
    expect(r.findings).toEqual([]);
    expect(r.severity).toBe("REPORT");
  });

  it("reports drift, naming the serial", () => {
    const r = checkStatusProjection(
      [unit({ status: "TERSEDIA" })],
      [
        event({ seq: 2, type: "TERJUAL", toStatus: "TERJUAL" }),
        event({ seq: 1 }),
      ],
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.subject).toBe("SER-001");
    expect(r.findings[0]?.detail).toContain("TERJUAL");
  });

  it("leaves a unit with no history to the orphan check", () => {
    expect(checkStatusProjection([unit()], []).findings).toEqual([]);
  });
});

describe("08 §6 — 2. location projection", () => {
  it("ignores events that did not move the unit", () => {
    const r = checkLocationProjection(
      [unit({ locationId: "loc2" })],
      [
        event({ seq: 1, toLocationId: "loc1" }),
        event({ seq: 2, type: "DIPINDAH", toLocationId: "loc2" }),
        event({ seq: 3, type: "DICATAT", toLocationId: null }),
      ],
    );
    expect(r.findings).toEqual([]);
  });

  it("reports a stale location", () => {
    const r = checkLocationProjection(
      [unit({ locationId: "loc1" })],
      [
        event({ seq: 2, type: "DIPINDAH", toLocationId: "loc2" }),
        event({ seq: 1 }),
      ],
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.detail).toContain("loc2");
  });

  it("says nothing about a unit that never moved", () => {
    expect(
      checkLocationProjection([unit()], [event({ toLocationId: null })])
        .findings,
    ).toEqual([]);
  });
});

describe("08 §6 — 3. ledger continuity", () => {
  it("accepts a gapless run", () => {
    const r = checkLedgerContinuity([
      event({ seq: 1 }),
      event({ seq: 2 }),
      event({ seq: 3 }),
    ]);
    expect(r.findings).toEqual([]);
    expect(r.severity).toBe("ALERT");
  });

  it("alerts on a gap", () => {
    const r = checkLedgerContinuity([event({ seq: 1 }), event({ seq: 3 })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.detail).toContain("melompat");
    expect(r.findings[0]?.subject).toBe("u1"); // no serial map given
  });

  it("alerts on a duplicate, and names the serial when it can", () => {
    const r = checkLedgerContinuity(
      [event({ seq: 1 }), event({ seq: 1 })],
      new Map([["u1", "SER-001"]]),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.detail).toContain("dua kali");
    expect(r.findings[0]?.subject).toBe("SER-001");
  });

  it("alerts when the ledger does not start at 1", () => {
    const r = checkLedgerContinuity([event({ seq: 2 })]);
    expect(r.findings[0]?.detail).toContain("menunggu 1");
  });

  it("reports each unit at most once", () => {
    const r = checkLedgerContinuity([
      event({ unitId: "u1", seq: 2 }),
      event({ unitId: "u1", seq: 4 }),
      event({ unitId: "u2", seq: 1 }),
    ]);
    expect(r.findings).toHaveLength(1);
  });
});

describe("08 §6 — 4. order arithmetic", () => {
  it("accepts a correct total", () => {
    const r = checkOrderArithmetic(
      [order({ total: 90n, discount: 20n, extra: 10n })],
      [item({ sub: 100n })],
    );
    expect(r.findings).toEqual([]);
  });

  it("alerts when the total disagrees with the lines", () => {
    const r = checkOrderArithmetic(
      [order({ total: 999n })],
      [item({ sub: 100n })],
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.subject).toBe("SI-2026/07-000001");
  });

  it("treats an order with no lines as zero", () => {
    expect(checkOrderArithmetic([order({ total: 0n })], []).findings).toEqual(
      [],
    );
    expect(
      checkOrderArithmetic([order({ total: 5n })], []).findings,
    ).toHaveLength(1);
  });
});

describe("08 §6 — 5. payment coverage", () => {
  it("accepts paidTotal that matches the settled payments", () => {
    expect(checkPaymentCoverage([order()], [payment()]).findings).toEqual([]);
  });

  it("ignores unsettled payments and payments on a PO", () => {
    const r = checkPaymentCoverage(
      [order({ paidTotal: 0n })],
      [payment({ status: "BELUM" }), payment({ orderId: null })],
    );
    expect(r.findings).toEqual([]);
  });

  it("nets a refund back out", () => {
    const r = checkPaymentCoverage(
      [order({ paidTotal: 40n })],
      [
        payment({ amount: 100n }),
        payment({ amount: 60n, direction: "KELUAR" }),
      ],
    );
    expect(r.findings).toEqual([]);
  });

  it("alerts when they disagree", () => {
    const r = checkPaymentCoverage([order({ paidTotal: 100n })], []);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.detail).toContain("100");
  });
});

describe("08 §6 — 6. orphan units", () => {
  it("passes a unit that was received", () => {
    expect(
      checkOrphanUnits([unit()], [event({ type: "DITERIMA" })]).findings,
    ).toEqual([]);
  });

  it("reports a unit with no DITERIMA event", () => {
    const r = checkOrphanUnits([unit()], [event({ type: "DIPINDAH" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.severity).toBe("REPORT");
  });
});

describe("08 §6 — 7. sold twice", () => {
  it("passes a serial on one open line", () => {
    expect(checkSoldTwice([item()]).findings).toEqual([]);
  });

  it("ignores returned lines and non-serialised lines", () => {
    const r = checkSoldTwice([
      item({ id: "i1", returnedAt: new Date(0) }),
      item({ id: "i2" }),
      item({ id: "i3", unitId: null }),
    ]);
    expect(r.findings).toEqual([]);
  });

  it("alerts when one serial is open on two orders", () => {
    const r = checkSoldTwice(
      [item({ id: "i1", orderId: "o1" }), item({ id: "i2", orderId: "o2" })],
      new Map([["u1", "SER-001"]]),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.subject).toBe("SER-001");
    expect(r.findings[0]?.detail).toContain("o1, o2");
  });

  it("falls back to the unit id when no serial is known", () => {
    const r = checkSoldTwice([
      item({ id: "i1" }),
      item({ id: "i2", orderId: "o2" }),
    ]);
    expect(r.findings[0]?.subject).toBe("u1");
  });
});

describe("08 §6 — 8. shift cash", () => {
  it("accepts a till that adds up", () => {
    expect(
      checkShiftCash([shift({ openFloat: 0n, expected: 100n })], [payment()])
        .findings,
    ).toEqual([]);
  });

  it("counts the opening float", () => {
    const r = checkShiftCash(
      [shift({ openFloat: 50n, expected: 150n })],
      [payment()],
    );
    expect(r.findings).toEqual([]);
  });

  it("ignores non-cash, unsettled, and payments outside any shift", () => {
    const r = checkShiftCash(
      [shift({ expected: 0n })],
      [
        payment({ method: "QRIS" }),
        payment({ status: "GAGAL" }),
        payment({ shiftId: null }),
      ],
    );
    expect(r.findings).toEqual([]);
  });

  it("nets cash paid out", () => {
    const r = checkShiftCash(
      [shift({ expected: 70n })],
      [
        payment({ amount: 100n }),
        payment({ amount: 30n, direction: "KELUAR" }),
      ],
    );
    expect(r.findings).toEqual([]);
  });

  it("reports a mismatch", () => {
    const r = checkShiftCash([shift({ expected: 999n })], [payment()]);
    expect(r.findings).toHaveLength(1);
    expect(r.severity).toBe("REPORT");
  });

  it("reports a shift that took no cash but expected some", () => {
    const r = checkShiftCash([shift({ openFloat: 0n, expected: 500n })], []);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.detail).toContain("kas bersih 0");
  });
});

describe("all eight together", () => {
  const clean = {
    units: [unit()],
    events: [event()],
    orders: [order()],
    orderItems: [item()],
    payments: [payment()],
    shifts: [shift()],
  };

  it("runs all eight checks in §6's order", () => {
    const reports = runAllChecks(clean);
    expect(reports.map((r) => r.name)).toEqual([
      "PROYEKSI_STATUS",
      "PROYEKSI_LOKASI",
      "KONTINUITAS_LEDGER",
      "ARITMATIKA_ORDER",
      "CAKUPAN_PEMBAYARAN",
      "UNIT_YATIM",
      "TERJUAL_GANDA",
      "KAS_SHIFT",
    ]);
    expect(isClean(reports)).toBe(true);
  });

  it("catches a deliberately corrupted fixture", () => {
    const reports = runAllChecks({
      ...clean,
      units: [unit({ status: "TERJUAL" })],
    });
    expect(isClean(reports)).toBe(false);
    const status = reports.find((r) => r.name === "PROYEKSI_STATUS");
    expect(status?.findings).toHaveLength(1);
  });
});
