/**
 * The Stock Movement History as a function (owner ask 2026-09-24: *"make the
 * movement log editable … each row is editable"*): what the rows are, what a
 * correction may change, and how far it reaches into the unit.
 */
import { describe, expect, it } from "vitest";
import { buildSeed, type MockDb, type StockMove } from "../src/mock/seed.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import {
  applyStockHistoryEdit,
  stockHistoryRows,
  stockHistorySkuId,
} from "../src/lib/stockHistory.js";

/** A fresh shop, with a counted product's correction on its ledger. */
function shop(): { db: MockDb; move: StockMove } {
  const db = buildSeed();
  const reason = db.reasons.find((r) => r.activity === "ADJUSTMENT")!;
  const counted = db.skus.find((s) => !skuTracksSerial(db, s.id))!;
  const move: StockMove = {
    id: "sm-test-korek",
    skuId: counted.id,
    locationId: db.myWarehouseId,
    qty: 2,
    cost: 0,
    type: "KOREKSI",
    at: "2026-09-20T03:00:00.000Z",
    reasonId: reason.id,
    note: "Adjusted in — found in the drawer",
    staff: "Michella",
  };
  db.stockMoves.push(move);
  return { db, move };
}

const unitOf = (db: MockDb, serial: string) =>
  db.units.find((u) => u.serial === serial)!;

describe("stockHistoryRows", () => {
  it("lists every unit adjustment, and a counted correction as a quantity", () => {
    const { db, move } = shop();
    const rows = stockHistoryRows(db);
    for (const a of db.adjustments) {
      expect(rows.find((r) => r.id === a.id)).toEqual(a);
    }
    const counted = rows.find((r) => r.id === move.id)!;
    expect(counted).toMatchObject({
      serial: "",
      kind: "IN",
      description: move.note,
      reasonId: move.reasonId,
      counted: { skuId: move.skuId, qty: 2 },
    });
    expect(stockHistorySkuId(db, counted)).toBe(move.skuId);
  });

  it("names a unit row's product through its serial", () => {
    const { db } = shop();
    const row = stockHistoryRows(db).find((r) => r.serial !== "")!;
    expect(stockHistorySkuId(db, row)).toBe(unitOf(db, row.serial).skuId);
  });

  it("leaves a move that is not a reasoned correction out", () => {
    const { db } = shop();
    const arrival = db.stockMoves.find((m) => m.type !== "KOREKSI")!;
    expect(stockHistoryRows(db).some((r) => r.id === arrival.id)).toBe(false);
  });
});

describe("applyStockHistoryEdit on a unit's row", () => {
  it("corrects when, why and the sentence, and the unit follows while it still agrees", () => {
    const { db } = shop();
    const adj = db.adjustments[0]!;
    const unit = unitOf(db, adj.serial);
    // The adjustment wrote its sentence and a reading onto the unit.
    unit.description = adj.description;
    adj.batteryHealth = 91;
    unit.batteryHealth = 91;
    const other = db.reasons.find(
      (r) => r.activity === "ADJUSTMENT" && r.id !== adj.reasonId,
    )!;
    const row = stockHistoryRows(db).find((r) => r.id === adj.id)!;
    const before = { ...adj };

    expect(
      applyStockHistoryEdit(db, row, {
        at: "2026-09-10T02:00:00.000Z",
        reasonId: other.id,
        description: "  Lecet di sudut kanan  ",
        batteryHealth: 19,
      }),
    ).toBe(true);

    expect(adj).toMatchObject({
      at: "2026-09-10T02:00:00.000Z",
      reasonId: other.id,
      description: "Lecet di sudut kanan",
      batteryHealth: 19,
    });
    // What the row IS did not move.
    expect(adj.serial).toBe(before.serial);
    expect(adj.kind).toBe(before.kind);
    expect(adj.batchId).toBe(before.batchId);
    expect(adj.staff).toBe(before.staff);
    // The unit carried this adjustment's figures, so it carries the corrected ones.
    expect(unit.description).toBe("Lecet di sudut kanan");
    expect(unit.batteryHealth).toBe(19);
  });

  it("does not touch a unit that has since been described or read differently", () => {
    const { db } = shop();
    const adj = db.adjustments[0]!;
    const unit = unitOf(db, adj.serial);
    adj.batteryHealth = 91;
    unit.description = "Sudah diganti layar";
    unit.batteryHealth = 87;
    const row = stockHistoryRows(db).find((r) => r.id === adj.id)!;

    applyStockHistoryEdit(db, row, {
      at: adj.at,
      reasonId: adj.reasonId,
      description: "Corrected",
      batteryHealth: 19,
    });

    expect(adj.description).toBe("Corrected");
    expect(adj.batteryHealth).toBe(19);
    expect(unit.description).toBe("Sudah diganti layar");
    expect(unit.batteryHealth).toBe(87);
  });

  it("withdraws a reading from the unit when the row withdraws it", () => {
    const { db } = shop();
    const adj = db.adjustments[0]!;
    const unit = unitOf(db, adj.serial);
    adj.cycleCount = 312;
    adj.fcc = 4100;
    unit.cycleCount = 312;
    unit.fcc = 4100;
    const row = stockHistoryRows(db).find((r) => r.id === adj.id)!;

    applyStockHistoryEdit(db, row, {
      at: adj.at,
      reasonId: adj.reasonId,
      description: adj.description,
    });

    expect(adj.cycleCount).toBeUndefined();
    expect(adj.fcc).toBeUndefined();
    expect(unit.cycleCount).toBeUndefined();
    expect(unit.fcc).toBeUndefined();
  });

  it("never blanks the unit's description from an emptied box", () => {
    const { db } = shop();
    const adj = db.adjustments[0]!;
    const unit = unitOf(db, adj.serial);
    const said = adj.description;
    unit.description = said;
    const row = stockHistoryRows(db).find((r) => r.id === adj.id)!;

    applyStockHistoryEdit(db, row, {
      at: adj.at,
      reasonId: adj.reasonId,
      description: "   ",
    });

    expect(adj.description).toBe("");
    expect(unit.description).toBe(said);
  });
});

describe("applyStockHistoryEdit on a counted product's row", () => {
  it("corrects the note, the reason and the date, and never the quantity", () => {
    const { db, move } = shop();
    const other = db.reasons.find(
      (r) => r.activity === "ADJUSTMENT" && r.id !== move.reasonId,
    )!;
    const row = stockHistoryRows(db).find((r) => r.id === move.id)!;

    expect(
      applyStockHistoryEdit(db, row, {
        at: "2026-09-21T08:30:00.000Z",
        reasonId: other.id,
        description: "Found behind the till",
        // A reading typed against a counted row goes nowhere.
        batteryHealth: 50,
      }),
    ).toBe(true);

    const stored = db.stockMoves.find((m) => m.id === move.id)!;
    expect(stored).toMatchObject({
      at: "2026-09-21T08:30:00.000Z",
      reasonId: other.id,
      note: "Found behind the till",
      qty: 2,
      skuId: move.skuId,
      locationId: move.locationId,
      type: "KOREKSI",
    });
    expect("batteryHealth" in stored).toBe(false);
  });

  it("drops the note when the box is emptied", () => {
    const { db, move } = shop();
    const row = stockHistoryRows(db).find((r) => r.id === move.id)!;
    applyStockHistoryEdit(db, row, {
      at: move.at,
      reasonId: move.reasonId!,
      description: "",
    });
    expect("note" in db.stockMoves.find((m) => m.id === move.id)!).toBe(false);
  });

  it("answers false for a row that is gone", () => {
    const { db, move } = shop();
    const row = stockHistoryRows(db).find((r) => r.id === move.id)!;
    db.stockMoves = db.stockMoves.filter((m) => m.id !== move.id);
    expect(
      applyStockHistoryEdit(db, row, {
        at: move.at,
        reasonId: move.reasonId!,
        description: "x",
      }),
    ).toBe(false);
  });
});
