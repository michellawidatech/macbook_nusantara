import { describe, expect, it } from "vitest";
import {
  DP_DEFAULT_AMOUNT,
  DP_DEFAULT_DAYS,
  dpRuleOf,
  headerState,
  heldUntilOf,
  holdProgress,
  isReservationStatus,
  itemState,
  RESERVATION_STATUSES,
  type HoldState,
} from "../src/reservationState.js";

describe("itemState", () => {
  it("reads a held machine off its unit", () => {
    expect(itemState("DIRESERVASI")).toBe("HELD");
  });

  it("reads a collected machine off its unit", () => {
    expect(itemState("TERJUAL")).toBe("BOUGHT");
  });

  it("treats every other status as let go", () => {
    for (const s of [
      "TERSEDIA",
      "QC",
      "RETUR_SUPPLIER",
      "HILANG",
      "KOREKSI_KELUAR",
      "KLAIM_GARANSI",
      "REFUND_KLAIM",
    ] as const) {
      expect(itemState(s)).toBe("RELEASED");
    }
  });

  it("answers RELEASED for a machine that is not there at all", () => {
    // An item with no unit behind it. Whatever happened to it, nobody is
    // holding it now.
    expect(itemState(null)).toBe("RELEASED");
  });
});

describe("headerState", () => {
  it("stays open while anything is still held", () => {
    expect(headerState("TERJADWAL", ["HELD", "BOUGHT", "RELEASED"])).toBe(
      "TERJADWAL",
    );
  });

  it("is collected once something sold and nothing is left held", () => {
    expect(headerState("TERJADWAL", ["BOUGHT", "RELEASED"])).toBe("SELESAI");
  });

  it("is cancelled when nothing sold and nothing is held", () => {
    expect(headerState("TERJADWAL", ["RELEASED", "RELEASED"])).toBe("BATAL");
  });

  it("is cancelled when every machine has been taken off it", () => {
    expect(headerState("TERJADWAL", [])).toBe("BATAL");
  });

  it("keeps a part-collected hold open — that is what partial collection is", () => {
    expect(headerState("TERJADWAL", ["BOUGHT", "HELD"])).toBe("TERJADWAL");
  });

  /**
   * The monotone rule. Nothing in the schema binds a unit to at most one open
   * hold, so these item statuses are not necessarily about THIS hold.
   */
  describe("a settled hold is a receipt", () => {
    it("does not resurrect a cancelled hold whose machine somebody else has since held", () => {
      // Hold A was cancelled; its machine went back to stock and hold B took
      // it. Projecting A's items now sees DIRESERVASI.
      expect(headerState("BATAL", ["HELD"])).toBe("BATAL");
    });

    it("does not claim a cancelled hold was collected when its machine sold to a stranger", () => {
      expect(headerState("BATAL", ["BOUGHT"])).toBe("BATAL");
    });

    it("does not reopen a completed hold", () => {
      expect(headerState("SELESAI", ["HELD"])).toBe("SELESAI");
      expect(headerState("SELESAI", ["RELEASED"])).toBe("SELESAI");
    });
  });
});

describe("holdProgress", () => {
  it("counts each disposition", () => {
    const items: HoldState[] = ["HELD", "HELD", "BOUGHT", "RELEASED"];
    expect(holdProgress(items)).toEqual({
      held: 2,
      bought: 1,
      released: 1,
      total: 4,
    });
  });
});

describe("the vocabulary", () => {
  it("is the schema's, not the mock's", () => {
    expect(RESERVATION_STATUSES).toEqual(["TERJADWAL", "SELESAI", "BATAL"]);
  });

  it("rejects the mock's old words, so a stale caller fails loudly", () => {
    expect(isReservationStatus("ACTIVE")).toBe(false);
    expect(isReservationStatus("DONE")).toBe(false);
    expect(isReservationStatus("CANCELLED")).toBe(false);
    expect(isReservationStatus("TERJADWAL")).toBe(true);
  });
});

describe("a hold without a DP (2026-10-27)", () => {
  it("reads a TERSEDIA unit as softly reserved only when told it is soft", () => {
    expect(itemState("TERSEDIA", true)).toBe("SOFT");
    expect(itemState("TERSEDIA")).toBe("RELEASED");
    // Soft says nothing about a unit that is held, sold or gone elsewhere.
    expect(itemState("DIRESERVASI", true)).toBe("HELD");
    expect(itemState("TERJUAL", true)).toBe("BOUGHT");
    expect(itemState("QC", true)).toBe("RELEASED");
  });

  it("keeps a softly reserved hold open", () => {
    expect(headerState("TERJADWAL", ["SOFT"])).toBe("TERJADWAL");
    expect(headerState("TERJADWAL", ["SOFT", "BOUGHT"])).toBe("TERJADWAL");
    expect(holdProgress(["SOFT", "HELD", "BOUGHT"]).held).toBe(2);
  });
});

describe("a hold with an open DP (2026-10-27)", () => {
  it("never closes itself while the money waits for a decision", () => {
    expect(headerState("TERJADWAL", ["RELEASED"], { dpOpen: true })).toBe(
      "TERJADWAL",
    );
    // Bought without the DP on the sale: still staff's to settle.
    expect(headerState("TERJADWAL", ["BOUGHT"], { dpOpen: true })).toBe(
      "TERJADWAL",
    );
  });

  it("closes as before once the DP is settled", () => {
    expect(headerState("TERJADWAL", ["BOUGHT"], { dpOpen: false })).toBe(
      "SELESAI",
    );
    expect(headerState("TERJADWAL", ["RELEASED"], { dpOpen: false })).toBe(
      "BATAL",
    );
    // A decision already taken absorbs, as every settled hold does.
    expect(headerState("BATAL", ["RELEASED"], { dpOpen: true })).toBe("BATAL");
  });
});

describe("the DP rule", () => {
  it("is Rp500.000 for seven days until somebody types otherwise", () => {
    expect(dpRuleOf({})).toEqual({
      amount: DP_DEFAULT_AMOUNT,
      days: DP_DEFAULT_DAYS,
    });
    expect(DP_DEFAULT_AMOUNT).toBe(500_000);
    expect(DP_DEFAULT_DAYS).toBe(7);
    expect(dpRuleOf({ amount: "1000000", days: "3" })).toEqual({
      amount: 1_000_000,
      days: 3,
    });
  });

  it("falls back half by half on a blank, a zero or a non-number", () => {
    expect(dpRuleOf({ amount: " ", days: null })).toEqual({
      amount: 500_000,
      days: 7,
    });
    expect(dpRuleOf({ amount: "0", days: "abc" })).toEqual({
      amount: 500_000,
      days: 7,
    });
    expect(dpRuleOf({ amount: "250000.5", days: "-2" })).toEqual({
      amount: 500_000,
      days: 7,
    });
  });

  it("holds until the DP's moment plus the days", () => {
    const paid = new Date("2026-10-27T07:00:00.000Z");
    expect(heldUntilOf(paid, 7).toISOString()).toBe("2026-11-03T07:00:00.000Z");
  });
});
