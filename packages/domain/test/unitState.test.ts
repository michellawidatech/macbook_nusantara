import { describe, expect, it } from "vitest";
import {
  IllegalUnitTransitionError,
  TERMINAL_STATUSES,
  TRANSITIONS,
  UNIT_STATUSES,
  assertTransition,
  isStatusPreserving,
  isTerminal,
  legalTargets,
  statusAfter,
} from "../src/unitState.js";

describe("08 §4 — the unit state machine", () => {
  it("intake is the only way in", () => {
    expect(statusAfter(null, "DITERIMA")).toBe("QC");
    expect(statusAfter("QC", "QC_SELESAI")).toBe("TERSEDIA");
    expect(statusAfter("QC", "RETUR_SUPPLIER")).toBe("RETUR_SUPPLIER");
    expect(statusAfter("QC", "KOREKSI")).toBe("KOREKSI_KELUAR");
    expect(statusAfter(null, "TERJUAL")).toBeNull();
    // A unit that does not exist cannot be moved or noted.
    expect(statusAfter(null, "DIPINDAH")).toBeNull();
  });

  it("walks every arrow the diagram draws", () => {
    expect(statusAfter("TERSEDIA", "DIRESERVASI")).toBe("DIRESERVASI");
    expect(statusAfter("DIRESERVASI", "RESERVASI_BATAL")).toBe("TERSEDIA");
    expect(statusAfter("DIRESERVASI", "TERJUAL")).toBe("TERJUAL");
    expect(statusAfter("TERSEDIA", "TERJUAL")).toBe("TERJUAL");
    expect(statusAfter("TERSEDIA", "RETUR_SUPPLIER")).toBe("RETUR_SUPPLIER");
    expect(statusAfter("TERSEDIA", "OPNAME_HILANG")).toBe("HILANG");
    expect(statusAfter("HILANG", "OPNAME_DITEMUKAN")).toBe("TERSEDIA");
    expect(statusAfter("TERSEDIA", "KOREKSI")).toBe("KOREKSI_KELUAR");
    expect(statusAfter("TERJUAL", "RETUR_PELANGGAN")).toBe("TERSEDIA");
    expect(statusAfter("TERJUAL", "KLAIM_DIBUKA")).toBe("KLAIM_GARANSI");
  });

  it("resolves a warranty claim by its resolution", () => {
    expect(statusAfter("KLAIM_GARANSI", "KLAIM_SELESAI", "STOK")).toBe(
      "TERSEDIA",
    );
    expect(statusAfter("KLAIM_GARANSI", "KLAIM_SELESAI", "RETUR")).toBe(
      "RETUR_SUPPLIER",
    );
    expect(statusAfter("KLAIM_GARANSI", "KLAIM_SELESAI", "REFUND")).toBe(
      "REFUND_KLAIM",
    );
    // A claim cannot be closed without saying how.
    expect(statusAfter("KLAIM_GARANSI", "KLAIM_SELESAI")).toBeNull();
    // The standalone REFUND event lands in the same terminal status.
    expect(statusAfter("KLAIM_GARANSI", "REFUND")).toBe("REFUND_KLAIM");
  });

  it("rejects the sale of an already-sold unit", () => {
    expect(statusAfter("TERJUAL", "TERJUAL")).toBeNull();
    expect(statusAfter("DIRESERVASI", "DIRESERVASI")).toBeNull();
  });

  it("keeps status for events that only record something", () => {
    expect(isStatusPreserving("DIPINDAH")).toBe(true);
    expect(isStatusPreserving("DICATAT")).toBe(true);
    expect(isStatusPreserving("DIARSIPKAN")).toBe(true);
    expect(isStatusPreserving("TERJUAL")).toBe(false);

    expect(statusAfter("TERSEDIA", "DIPINDAH")).toBe("TERSEDIA");
    expect(statusAfter("TERJUAL", "DICATAT")).toBe("TERJUAL");
  });

  it("records nothing further once a unit reaches a terminal status", () => {
    for (const t of TERMINAL_STATUSES) {
      expect(isTerminal(t)).toBe(true);
      expect(legalTargets(t)).toEqual([]);
      expect(statusAfter(t, "DIPINDAH")).toBeNull();
      expect(statusAfter(t, "TERJUAL")).toBeNull();
    }
    expect(isTerminal("TERSEDIA")).toBe(false);
  });

  it("lists the legal next statuses", () => {
    expect(legalTargets(null)).toEqual(["QC"]);
    expect(legalTargets("QC").sort()).toEqual(
      ["KOREKSI_KELUAR", "RETUR_SUPPLIER", "TERSEDIA"].sort(),
    );
    expect(legalTargets("TERSEDIA").sort()).toEqual(
      [
        "DIRESERVASI",
        "HILANG",
        "KOREKSI_KELUAR",
        "RETUR_SUPPLIER",
        "TERJUAL",
      ].sort(),
    );
    // KLAIM_SELESAI reaches three statuses but each appears once.
    expect(legalTargets("KLAIM_GARANSI").sort()).toEqual(
      ["REFUND_KLAIM", "RETUR_SUPPLIER", "TERSEDIA"].sort(),
    );
  });

  it("names the serial and its current status when it rejects", () => {
    expect(() => assertTransition("SER-001", "TERJUAL", "TERJUAL")).toThrow(
      IllegalUnitTransitionError,
    );

    try {
      assertTransition("SER-001", "TERJUAL", "TERJUAL");
      expect.unreachable("the transition must be rejected");
    } catch (e) {
      const err = e as IllegalUnitTransitionError;
      expect(err.message).toContain("SER-001");
      expect(err.message).toContain("TERJUAL");
      expect(err.serial).toBe("SER-001");
      expect(err.from).toBe("TERJUAL");
      expect(err.type).toBe("TERJUAL");
      expect(err.resolution).toBeUndefined();
    }
  });

  it("says so when the unit is not in stock at all, or already final", () => {
    expect(() => assertTransition("SER-9", null, "TERJUAL")).toThrow(
      /belum tercatat di stok/,
    );
    expect(() => assertTransition("SER-9", "REFUND_KLAIM", "TERJUAL")).toThrow(
      /\(final\)/,
    );
  });

  it("names the resolution when one was given", () => {
    try {
      assertTransition("SER-7", "TERSEDIA", "KLAIM_SELESAI", "STOK");
      expect.unreachable("the transition must be rejected");
    } catch (e) {
      const err = e as IllegalUnitTransitionError;
      expect(err.message).toContain("resolusi STOK");
      expect(err.resolution).toBe("STOK");
    }
  });

  it("returns the projected status on a legal transition", () => {
    expect(assertTransition("SER-001", "TERSEDIA", "TERJUAL")).toBe("TERJUAL");
    expect(assertTransition("SER-001", null, "DITERIMA")).toBe("QC");
    expect(assertTransition("SER-001", "QC", "QC_SELESAI")).toBe("TERSEDIA");
  });

  it("only ever names statuses the ERD declares", () => {
    for (const t of TRANSITIONS) {
      expect(UNIT_STATUSES).toContain(t.to);
      if (t.from !== null) expect(UNIT_STATUSES).toContain(t.from);
    }
  });
});
