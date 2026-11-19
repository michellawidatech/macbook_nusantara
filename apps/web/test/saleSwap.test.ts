/**
 * A sale recorded on the wrong serial, swapped at a stock take (owner ask
 * 2026-11-19). `lib/saleSwap.ts` is the rule.
 */
import { describe, expect, it } from "vitest";
import { getDb, mutate } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";
import {
  saleOfSerial,
  saleSwapBlock,
  swapSaleUnit,
} from "../src/lib/saleSwap.js";
import { saleRowsOf } from "../src/lib/saleDeletion.js";

/** A sold unit whose sale can still be corrected, and a unit on the shelf. */
function pair(db: MockDb): { sold: string; shelf: string; code: string } {
  for (const o of db.orders) {
    for (const sold of o.serials) {
      const u = db.units.find((x) => x.serial === sold);
      if (u?.status !== "TERJUAL") continue;
      if (saleOfSerial(db, sold)?.id !== o.id) continue;
      if (saleRowsOf(db.events, sold, o.code) === null) continue;
      const before = db.events.filter((e) => e.serial === sold).length;
      if (before < 2) continue;
      // The same product when the seed has one; any shelf unit otherwise —
      // the rule does not ask, the dialog only ranks the same product first.
      const shelf =
        db.units.find((x) => x.status === "TERSEDIA" && x.skuId === u.skuId) ??
        db.units.find((x) => x.status === "TERSEDIA");
      if (shelf) return { sold, shelf: shelf.serial, code: o.code };
    }
  }
  throw new Error("the seed has no sold unit with a shelf twin");
}

describe("swapSaleUnit", () => {
  it("moves the sale to the unit that went out and puts the scanned one back", () => {
    const { sold, shelf, code } = pair(getDb());
    const order = saleOfSerial(getDb(), sold)!;
    const price = order.prices[sold];
    const soldFrom = getDb()
      .events.filter((e) => e.serial === sold)
      .sort((a, b) => a.seq - b.seq);
    const beforeSale = soldFrom[soldFrom.length - 2]!;

    let result: string | undefined;
    mutate((d) => {
      result = swapSaleUnit(d, sold, shelf, "swapped");
    });
    expect(result).toBe(code);

    const db = getDb();
    const o = db.orders.find((x) => x.id === order.id)!;
    expect(o.serials).toContain(shelf);
    expect(o.serials).not.toContain(sold);
    expect(o.prices[shelf]).toBe(price);
    expect(o.prices[sold]).toBeUndefined();

    const a = db.units.find((u) => u.serial === sold)!;
    expect(a.status).toBe(beforeSale.toStatus);
    expect(a.locationId).toBe(beforeSale.locationId);
    expect(
      db.events.some(
        (e) => e.serial === sold && e.type === "TERJUAL" && e.refCode === code,
      ),
    ).toBe(false);

    const b = db.units.find((u) => u.serial === shelf)!;
    expect(b.status).toBe("TERJUAL");
    const last = db.events
      .filter((e) => e.serial === shelf)
      .sort((x, y) => x.seq - y.seq)
      .at(-1)!;
    expect(last).toMatchObject({
      type: "TERJUAL",
      refCode: code,
      note: "swapped",
    });
  });

  it("refuses a unit that is not on the shelf, and one that is not sold", () => {
    const { sold, shelf } = pair(getDb());
    const db = getDb();
    expect(saleSwapBlock(db, shelf, sold)).toBe("NOT_SOLD");
    // Another sold unit: gone already, so it cannot take this sale.
    const other = db.units.find(
      (u) => u.status === "TERJUAL" && u.serial !== sold,
    )!.serial;
    expect(saleSwapBlock(db, sold, other)).toBe("NOT_ON_SHELF");
    expect(saleSwapBlock(db, sold, shelf)).toBeUndefined();
    let result: string | undefined = "x";
    mutate((d) => {
      result = swapSaleUnit(d, sold, other, "x");
    });
    expect(result).toBeUndefined();
  });

  it("refuses once the scanned unit has moved on since its sale", () => {
    const { sold, shelf } = pair(getDb());
    mutate((d) => {
      const seq = Math.max(
        ...d.events.filter((e) => e.serial === sold).map((e) => e.seq),
      );
      d.events.push({
        id: "ev-later",
        serial: sold,
        seq: seq + 1,
        type: "DICATAT",
        at: new Date().toISOString(),
        fromStatus: "TERJUAL",
        toStatus: "TERJUAL",
        locationId: d.units.find((u) => u.serial === sold)!.locationId,
        refCode: "SG-OTHER",
        staff: "Test",
      });
    });
    expect(saleSwapBlock(getDb(), sold, shelf)).toBe("MOVED_ON");
  });
});
