import { describe, expect, it } from "vitest";
import { buildSeed, type Unit } from "../src/mock/seed.js";
import { HELD_STATUSES, rollUpInventory } from "../src/lib/inventory.js";
import { priceOf } from "../src/lib/unitPrice.js";
import {
  BATTERY_BAND_LABEL,
  batteryBandOf,
  readUnitBattery,
} from "../src/lib/battery.js";

const db = buildSeed();
const rows = rollUpInventory(db.units, db.skus, db.models);
const bySku = (id: string) => rows.find((r) => r.skuId === id)!;

describe("rollUpInventory", () => {
  it("gives every catalogue SKU a row, in stock or not", () => {
    // "We don't have that one" is an answer the lookup has to be able to give.
    expect(rows).toHaveLength(db.skus.length);
    expect(rows.some((r) => r.onHand === 0)).toBe(true);
  });

  it("counts held units only — sold and written-off stock is not stock", () => {
    for (const row of rows) {
      const counted = db.units.filter(
        (u) => u.skuId === row.skuId && HELD_STATUSES.includes(u.status),
      );
      expect(row.onHand).toBe(counted.length);
      expect(row.units.every((u) => HELD_STATUSES.includes(u.status))).toBe(
        true,
      );
    }
    const sold = db.units.find((u) => u.status === "TERJUAL");
    expect(sold).toBeDefined();
    expect(bySku(sold!.skuId).units.map((u) => u.serial)).not.toContain(
      sold!.serial,
    );
  });

  it("the four quantities add up to what is held", () => {
    for (const r of rows) {
      expect(r.available + r.reserved + r.qc + r.service).toBe(r.onHand);
    }
  });

  it("values only what is actually sellable, at each machine's own price", () => {
    // A SUM over the machines, not a count times the catalogue price (owner
    // revision 2026-09-08). Multiplying would value a shelf of tired Cs at
    // what a shelf of As is worth.
    for (const r of rows) {
      const sellable = r.units.filter((u) =>
        ["TERSEDIA", "DIRESERVASI"].includes(u.status),
      );
      expect(r.value).toBe(
        sellable.reduce((t, u) => t + priceOf(u, r.listPrice), 0),
      );
    }
  });

  it("shows a range only where the machines actually disagree", () => {
    for (const r of rows) {
      const sellable = r.units.filter((u) =>
        ["TERSEDIA", "DIRESERVASI"].includes(u.status),
      );
      const prices = sellable.map((u) => priceOf(u, r.listPrice));
      expect(r.store.count).toBe(prices.length);
      if (prices.length > 0) {
        expect(r.store.min).toBe(Math.min(...prices));
        expect(r.store.max).toBe(Math.max(...prices));
        expect(r.store.single).toBe(r.store.min === r.store.max);
      }
    }
    // The demo shelf has to contain at least one genuine range, or the feature
    // renders as a column of single figures and demonstrates nothing.
    expect(rows.some((r) => !r.store.single && r.store.count > 1)).toBe(true);
  });

  it("lists a marketplace price above the counter price", () => {
    for (const r of rows) {
      if (r.market.count === 0) continue;
      expect(r.market.min).toBeGreaterThanOrEqual(r.store.min);
    }
  });

  it("quantities follow the unit filter the page applied", () => {
    // The contract in the helper's docblock: the caller narrows units, this
    // counts what is left. A quantity that ignored the filter would be a lie
    // told next to the filter that produced it.
    // The band is CHOSEN from the data rather than written out. The old
    // version hard-coded a cycle band and asserted the seed happened to
    // contain one, which made this test a hostage to seed tuning — it broke
    // when the catalogue gained a model and passed again when it gained
    // another. Picking the first band that is actually populated tests the
    // contract instead of the fixture.
    //
    // Through `batteryBandOf` since 2026-09-08: the band is one vocabulary
    // over both eras, which is exactly what lets the page keep ONE filter over
    // a shelf holding 2017 bodies and M2s.
    const bandOf = (u: Unit) => batteryBandOf(readUnitBattery(u, db));
    const band = (["good", "fair", "bad"] as const)
      .map((g) => BATTERY_BAND_LABEL[g])
      .find((label) => db.units.some((u) => bandOf(u) === label));
    expect(
      band,
      "the seed should hold at least one measured battery",
    ).toBeDefined();
    const narrowed = db.units.filter((u) => bandOf(u) === band);
    expect(narrowed.length).toBeGreaterThan(0);
    const filtered = rollUpInventory(narrowed, db.skus, db.models);
    const held = filtered.reduce((t, r) => t + r.onHand, 0);
    expect(held).toBe(
      narrowed.filter((u) => HELD_STATUSES.includes(u.status)).length,
    );
    for (const r of filtered) {
      expect(r.units.every((u) => bandOf(u) === band)).toBe(true);
    }
  });

  it("reports the battery range held, and nothing when nobody has measured", () => {
    for (const r of rows) {
      // In whichever units this row's era reports. A row is one variant, so
      // one model, so one era — which is what makes a range meaningful at all.
      const counts = r.units
        .map((u) =>
          r.batteryEra === "CYCLES" ? u.cycleCount : u.batteryHealth,
        )
        .filter((c): c is number => c != null);
      if (counts.length === 0) {
        expect(r.batteryMin).toBeUndefined();
        expect(r.batteryMax).toBeUndefined();
      } else {
        expect(r.batteryMin).toBe(Math.min(...counts));
        expect(r.batteryMax).toBe(Math.max(...counts));
      }
    }
    // Accessories have no battery, so their rows must not invent a 0.
    const accessory = rows.find(
      (r) => r.category === "Accessory" && r.onHand > 0,
    );
    expect(accessory?.batteryMin).toBeUndefined();
  });

  it("lists available serials first, so a lookup reads top-down", () => {
    const row = rows.find((r) => r.available > 0 && r.onHand > r.available);
    expect(row).toBeDefined();
    expect(
      row!.units.slice(0, row!.available).every((u) => u.status === "TERSEDIA"),
    ).toBe(true);
  });
});

describe("the seeded battery readings", () => {
  /*
   * Guards the demo data, not the logic. The original spread silently missed
   * the middle band entirely — an arithmetic sequence over this few units
   * looks like it covers the range and does not.
   *
   * Across BOTH eras since 2026-09-08, and separately, because a shelf whose
   * fair band is populated only by 2017 bodies would leave the health filter
   * with nothing to demonstrate.
   */
  const seeded = buildSeed();
  const bandsOf = (units: readonly Unit[]) =>
    new Set(
      units.map((u) => batteryBandOf(readUnitBattery(u, seeded))).values(),
    );

  it("populate all three bands in the health era", () => {
    const present = bandsOf(
      seeded.units.filter(
        (u) =>
          u.batteryHealth != null &&
          readUnitBattery(u, seeded).mode === "HEALTH",
      ),
    );
    for (const grade of ["good", "fair", "bad"] as const) {
      expect(present, `no 2021+ unit is ${grade}`).toContain(
        BATTERY_BAND_LABEL[grade],
      );
    }
  });

  it("populate all three bands in the cycles era", () => {
    const present = bandsOf(
      seeded.units.filter(
        (u) =>
          u.cycleCount != null && readUnitBattery(u, seeded).mode === "CYCLES",
      ),
    );
    for (const grade of ["good", "fair", "bad"] as const) {
      expect(present, `no pre-2021 unit is ${grade}`).toContain(
        BATTERY_BAND_LABEL[grade],
      );
    }
  });

  it("never records a machine in the other era's units", () => {
    // One battery, one set of numbers. A unit carrying both would let two
    // columns disagree about the same machine.
    for (const u of seeded.units) {
      const mode = readUnitBattery(u, seeded).mode;
      if (mode === "CYCLES") expect(u.batteryHealth, u.serial).toBeUndefined();
      else expect(u.cycleCount, u.serial).toBeUndefined();
    }
  });
});
