/**
 * Undo a stock movement (owner ask 2026-10-29): the row leaves the history
 * and the unit, or the shelf, is what it was before.
 */
import { describe, expect, it } from "vitest";
import { buildSeed, type MockDb } from "../src/mock/seed.js";
import { removeLastEvent } from "../src/mock/store.js";
import { stockHistoryRows } from "../src/lib/stockHistory.js";
import { undoBlock, undoStockMovement } from "../src/lib/stockUndo.js";

const AT = "2026-10-29T03:00:00.000Z";

/** A seed with one unit moved to another warehouse by an IN adjustment. */
function moved() {
  const db = buildSeed() as MockDb;
  const unit = db.units.find((u) => u.status === "TERSEDIA")!;
  const from = unit.locationId;
  const to = db.warehouses.find((w) => w.id !== from)!.id;
  const seq = Math.max(
    ...db.events.filter((e) => e.serial === unit.serial).map((e) => e.seq),
  );
  db.events.push({
    id: "ev-undo",
    serial: unit.serial,
    seq: seq + 1,
    type: "KOREKSI",
    at: AT,
    fromStatus: "TERSEDIA",
    toStatus: "TERSEDIA",
    locationId: to,
    note: "Moved",
    staff: "Ersen",
  });
  unit.locationId = to;
  db.adjustments.unshift({
    id: "adj-undo",
    serial: unit.serial,
    description: "",
    reasonId: db.reasons[0]!.id,
    at: AT,
    staff: "Ersen",
    kind: "IN",
    batchId: "adjb-undo",
  });
  const row = stockHistoryRows(db).find((r) => r.id === "adj-undo")!;
  return { db, unit, from, to, row };
}

describe("undoStockMovement", () => {
  it("puts a transferred unit back where it was and erases the row", () => {
    const { db, unit, from, row } = moved();
    expect(undoBlock(db, row)).toBeNull();
    expect(undoStockMovement(db, row, removeLastEvent)).toBe(true);
    expect(db.units.find((u) => u.serial === unit.serial)!.locationId).toBe(
      from,
    );
    expect(db.events.some((e) => e.id === "ev-undo")).toBe(false);
    expect(stockHistoryRows(db).some((r) => r.id === "adj-undo")).toBe(false);
  });

  it("refuses once the unit has a newer row", () => {
    const { db, unit, row } = moved();
    db.events.push({
      id: "ev-later",
      serial: unit.serial,
      seq: 999,
      type: "DICATAT",
      at: "2026-10-29T05:00:00.000Z",
      fromStatus: "TERSEDIA",
      toStatus: "TERSEDIA",
      locationId: unit.locationId,
      staff: "Ersen",
    });
    expect(undoBlock(db, row)).toBe("MOVED_ON");
    expect(undoStockMovement(db, row, removeLastEvent)).toBe(false);
    expect(db.adjustments.some((a) => a.id === "adj-undo")).toBe(true);
  });

  it("refuses a row that brought a new serial into the system", () => {
    const { db, row } = moved();
    expect(undoBlock(db, { ...row, newUnit: true })).toBe("CREATED_UNIT");
  });

  it("refuses an OUT that released a reservation", () => {
    const { db, row } = moved();
    db.events.find((e) => e.id === "ev-undo")!.fromStatus = "DIRESERVASI";
    expect(undoBlock(db, { ...row, kind: "OUT" })).toBe("RELEASED_HOLD");
  });

  it("takes a counted adjustment off the shelf, never below zero", () => {
    const db = buildSeed() as MockDb;
    const sku = db.skus.find((s) =>
      db.stockMoves.some((m) => m.skuId === s.id),
    )!;
    const loc = db.warehouses[0]!.id;
    db.stockMoves.push({
      id: "sm-undo",
      skuId: sku.id,
      locationId: loc,
      qty: 3,
      cost: 0,
      type: "KOREKSI",
      at: AT,
      reasonId: db.reasons[0]!.id,
      note: "Adjusted in",
      staff: "Ersen",
    });
    const row = stockHistoryRows(db).find((r) => r.id === "sm-undo")!;
    expect(undoBlock(db, row)).toBeNull();
    // Two of the three sold since: the undo would leave the shelf at -2.
    db.stockMoves.push({
      id: "sm-sold",
      skuId: sku.id,
      locationId: loc,
      qty:
        -(
          3 +
          db.stockMoves
            .filter(
              (m) =>
                m.skuId === sku.id &&
                m.locationId === loc &&
                m.id !== "sm-undo",
            )
            .reduce((n, m) => n + m.qty, 0)
        ) + 1,
      cost: 0,
      type: "TERJUAL",
      at: AT,
      staff: "Ersen",
    });
    expect(undoBlock(db, row)).toBe("SHELF_SHORT");
    db.stockMoves = db.stockMoves.filter((m) => m.id !== "sm-sold");
    expect(undoStockMovement(db, row, removeLastEvent)).toBe(true);
    expect(db.stockMoves.some((m) => m.id === "sm-undo")).toBe(false);
  });
});
