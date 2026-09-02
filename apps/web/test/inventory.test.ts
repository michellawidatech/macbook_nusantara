import { describe, expect, it } from "vitest";
import { buildSeed } from "../src/mock/seed.js";
import { HELD_STATUSES, rollUpInventory } from "../src/lib/inventory.js";
import { batteryBand, batteryBands } from "../src/lib/battery.js";

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

  it("values only what is actually sellable, at the variant's price", () => {
    // `fromPrice` — the cheapest unit a customer could walk out with — was the
    // other half of this test until 2026-08-27. It went with the per-unit
    // price: there is one number per row now, so a "from" would be inventing a
    // range that does not exist.
    for (const r of rows) {
      const sellable = r.units.filter((u) =>
        ["TERSEDIA", "DIRESERVASI"].includes(u.status),
      );
      expect(r.value).toBe(sellable.length * r.listPrice);
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
    const band = batteryBands()
      .map((b) => b.label)
      .find((label) =>
        db.units.some((u) => batteryBand(u.batteryHealth) === label),
      );
    expect(
      band,
      "the seed should hold at least one measured battery",
    ).toBeDefined();
    const narrowed = db.units.filter(
      (u) => batteryBand(u.batteryHealth) === band,
    );
    expect(narrowed.length).toBeGreaterThan(0);
    const filtered = rollUpInventory(narrowed, db.skus, db.models);
    const held = filtered.reduce((t, r) => t + r.onHand, 0);
    expect(held).toBe(
      narrowed.filter((u) => HELD_STATUSES.includes(u.status)).length,
    );
    for (const r of filtered) {
      expect(r.units.every((u) => batteryBand(u.batteryHealth) === band)).toBe(
        true,
      );
    }
  });

  it("reports the battery range held, and nothing when nobody has measured", () => {
    for (const r of rows) {
      const counts = r.units
        .map((u) => u.batteryHealth)
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
  it("populate all three bands, so the filter has something to filter", () => {
    // Guards the demo data, not the logic. The previous spread silently missed
    // the middle band entirely — an arithmetic sequence over this few units
    // looks like it covers the range and does not.
    const seeded = buildSeed();
    const present = new Set(
      seeded.units
        .filter((u) => u.batteryHealth != null)
        .map((u) => batteryBand(u.batteryHealth)),
    );
    for (const { label } of batteryBands()) {
      expect(present, `no seeded unit lands in "${label}"`).toContain(label);
    }
  });
});
