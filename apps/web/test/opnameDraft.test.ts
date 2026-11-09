/**
 * A draft's figures are re-judged against the store as it is now (owner
 * report 2026-11-09): the Stock Opname list kept printing 19 unknown for a
 * draft whose units on service were saved as unknown under the old rule.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../src/mock/store.js";
import { draftFigures } from "../src/lib/opnameDraft.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import type { MockDb, OpnameRec } from "../src/mock/seed.js";

function draft(over: Partial<OpnameRec>): OpnameRec {
  return {
    id: "op-figures",
    code: "SO-2026/11-000099",
    locationIds: [],
    rackIds: [],
    categories: [],
    conditions: [],
    date: "2026-11-09",
    at: "2026-11-09T10:00:00.000Z",
    counted: [],
    counts: {},
    missing: [],
    unknown: [],
    notes: {},
    surplus: {},
    status: "DRAFT",
    ...over,
  } as OpnameRec;
}

describe("draftFigures", () => {
  it("counts a unit on service in its own warehouse, though it was saved as unknown", () => {
    const base = getDb();
    const unit = base.units.find(
      (u) => u.status === "TERSEDIA" && skuTracksSerial(base, u.skuId),
    )!;
    const db: MockDb = {
      ...base,
      units: base.units.map((u) =>
        u.serial === unit.serial ? { ...u, status: "SERVIS" } : u,
      ),
    };
    const f = draftFigures(
      db,
      draft({ locationIds: [unit.locationId], unknown: [unit.serial] }),
    );
    expect(f.counted).toContain(unit.serial);
    expect(f.unknown).not.toContain(unit.serial);
    expect(f.missing).not.toContain(unit.serial);
  });

  it("still calls a unit filed in another warehouse unknown", () => {
    const db = getDb();
    const unit = db.units.find(
      (u) => u.status === "TERSEDIA" && skuTracksSerial(db, u.skuId),
    )!;
    const other = db.warehouses.find((w) => w.id !== unit.locationId)!;
    const f = draftFigures(
      db,
      draft({ locationIds: [other.id], counted: [unit.serial] }),
    );
    expect(f.unknown).toEqual([unit.serial]);
    expect(f.counted).toEqual([]);
  });
});
