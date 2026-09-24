/**
 * The Inventory table's lines: one per variant, grade and warehouse (owner ask
 * 2026-09-19, which replaced the product → grade → serial nesting).
 */
import { averageCost, onHand, stockLevels } from "../src/lib/stock.js";
import { describe, expect, it } from "vitest";
import { buildSeed, type Unit } from "../src/mock/seed.js";
import {
  HELD_STATUSES,
  SELLABLE_STATUSES,
  inventoryLines,
  isSellable,
  lineKey,
} from "../src/lib/inventory.js";
import { priceOf } from "../src/lib/unitPrice.js";
import { costIndex } from "../src/lib/service.js";
import { gradeRank } from "../src/lib/condition.js";
import {
  BATTERY_BAND_LABEL,
  batteryBandOf,
  readUnitBattery,
} from "../src/lib/battery.js";

const db = buildSeed();
const costOf = costIndex(db);
const total = (u: Unit) => costOf(u).total;
const lines = inventoryLines(db.units, db, { costOf: total });

describe("inventoryLines", () => {
  it("puts every held unit on exactly one line, and nothing that has gone", () => {
    const held = db.units.filter((u) => HELD_STATUSES.includes(u.status));
    const listed = lines.flatMap((l) => l.units.map((u) => u.serial));
    expect(listed.slice().sort()).toEqual(held.map((u) => u.serial).sort());
    const sold = db.units.find((u) => u.status === "TERJUAL");
    expect(sold, "the seed should hold a sold unit").toBeDefined();
    expect(listed).not.toContain(sold!.serial);
  });

  it("is one variant, at one grade, in one warehouse per line", () => {
    for (const l of lines) {
      expect(l.units.length).toBeGreaterThan(0);
      expect(l.key).toBe(lineKey(l.skuId, l.grade, l.locationId));
      for (const u of l.units) {
        expect(u.skuId).toBe(l.skuId);
        expect(u.grade || undefined).toBe(l.grade);
        expect(u.locationId).toBe(l.locationId);
      }
    }
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    // The flat table exists because one variant spans several lines; the demo
    // shelf has to show that, or the screen demonstrates nothing.
    const perSku = new Map<string, number>();
    for (const l of lines) perSku.set(l.skuId, (perSku.get(l.skuId) ?? 0) + 1);
    expect([...perSku.values()].some((n) => n > 1)).toBe(true);
  });

  it("the four quantities add up to what is held", () => {
    for (const l of lines) {
      expect(l.available + l.reserved + l.qc + l.service).toBe(l.onHand);
      expect(l.onHand).toBe(l.units.length);
    }
  });

  it("values only what is sellable, at each unit's own price", () => {
    // A SUM over the units, not a count times the catalogue price (owner
    // revision 2026-09-08).
    expect(SELLABLE_STATUSES).toEqual(["TERSEDIA", "DIRESERVASI"]);
    for (const l of lines) {
      const sellable = l.units.filter(isSellable);
      expect(l.value).toBe(
        sellable.reduce((t, u) => t + priceOf(u, l.listPrice), 0),
      );
    }
  });

  it("gives the sell price over the sellable units, as a range only where they disagree", () => {
    for (const l of lines) {
      const prices = l.units
        .filter(isSellable)
        .map((u) => priceOf(u, l.listPrice));
      expect(l.store.count).toBe(prices.length);
      if (prices.length > 0) {
        expect(l.store.min).toBe(Math.min(...prices));
        expect(l.store.max).toBe(Math.max(...prices));
        expect(l.store.single).toBe(l.store.min === l.store.max);
      }
    }
    // A line wholly in QC asks nothing yet — it has not been priced.
    const inQc = lines.find((l) => l.qc === l.onHand);
    expect(inQc, "the seed should hold a unit in QC").toBeDefined();
    expect(inQc!.store.count).toBe(0);
  });

  it("gives the unit price — Unit.buy — over every unit held, QC included", () => {
    for (const l of lines) {
      const buys = l.units.map((u) => u.buy);
      expect(l.buy.count).toBe(l.onHand);
      expect(l.buy.min).toBe(Math.min(...buys));
      expect(l.buy.max).toBe(Math.max(...buys));
    }
  });

  it("counts the invoice's expense share into what a unit cost (fixed 2026-09-19)", () => {
    // Inventory showed buy + repairs and left the shipping and tax share out,
    // so every margin read off this screen was flattered by it.
    for (const l of lines) {
      const totals = l.units.map(total);
      expect(l.cost.min).toBe(Math.min(...totals));
      expect(l.cost.max).toBe(Math.max(...totals));
      expect(l.cost.min).toBeGreaterThanOrEqual(l.buy.min);
    }
    expect(
      lines.some((l) => l.cost.max > l.buy.max),
      "some unit on the demo shelf should carry a share of its invoice's expenses",
    ).toBe(true);
  });

  it("lists in catalogue order, best grade first, then the shop's warehouse order", () => {
    const skuAt = (id: string) => db.skus.findIndex((s) => s.id === id);
    const whAt = (id: string | undefined) =>
      db.warehouses.findIndex((w) => w.id === id);
    for (let i = 1; i < lines.length; i += 1) {
      const a = lines[i - 1]!;
      const b = lines[i]!;
      const order =
        skuAt(a.skuId) - skuAt(b.skuId) ||
        gradeRank(a.grade) - gradeRank(b.grade) ||
        whAt(a.locationId) - whAt(b.locationId);
      expect(order, `${a.key} before ${b.key}`).toBeLessThanOrEqual(0);
    }
  });

  it("lists a line's available units first, and counts each status once", () => {
    const base = db.units.find((u) => u.status === "TERSEDIA")!;
    const copy = (serial: string, status: Unit["status"]): Unit => ({
      ...base,
      serial,
      status,
    });
    const [line, ...rest] = inventoryLines(
      [
        copy("SC02ZZ0000003", "QC"),
        copy("SC02ZZ0000001", "DIRESERVASI"),
        copy("SC02ZZ0000004", "SERVIS"),
        copy("SC02ZZ0000002", "TERSEDIA"),
      ],
      db,
      { costOf: (u) => u.buy },
    );
    expect(rest).toEqual([]);
    expect(line!.units.map((u) => u.status)).toEqual([
      "TERSEDIA",
      "DIRESERVASI",
      "QC",
      "SERVIS",
    ]);
    expect(line).toMatchObject({
      available: 1,
      reserved: 1,
      qc: 1,
      service: 1,
      onHand: 4,
    });
    expect(line!.store.count).toBe(2);
  });

  it("adds one empty line per variant with nothing held, and only when asked", () => {
    const withEmpty = inventoryLines(db.units, db, {
      costOf: total,
      includeEmpty: true,
    });
    const stocked = new Set(lines.map((l) => l.skuId));
    const empty = withEmpty.filter((l) => l.onHand === 0);
    // "We don't have that one" is an answer the lookup has to be able to give.
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.map((l) => l.skuId).sort()).toEqual(
      db.skus
        .filter((s) => !stocked.has(s.id))
        .map((s) => s.id)
        .sort(),
    );
    for (const l of empty) {
      expect(l.locationId).toBeUndefined();
      expect(l.grade).toBeUndefined();
      expect(l.units).toEqual([]);
      expect(l.store.count).toBe(0);
    }
    expect(withEmpty.length).toBe(lines.length + empty.length);
    expect(lines.every((l) => l.onHand > 0)).toBe(true);
  });

  it("marks the categories the shop counts rather than identifies", () => {
    // Counted products come off the stock ledger, not off units (2026-09-19).
    const withCounted = inventoryLines(db.units, db, {
      costOf: total,
      counted: {
        levels: stockLevels(db.stockMoves),
        averageCost: (skuId) => averageCost(db, skuId),
      },
    });
    const accessory = withCounted.find((l) => l.category === "Accessory");
    expect(accessory, "the seed should hold an accessory").toBeDefined();
    expect(accessory!.tracksSerial).toBe(false);
    expect(accessory!.counted).toBe(true);
    expect(accessory!.units).toEqual([]);
    expect(accessory!.available).toBe(
      onHand(db.stockMoves, accessory!.skuId, accessory!.locationId),
    );
    expect(lines.some((l) => l.category === "Accessory")).toBe(false);
    expect(
      lines
        .filter((l) => l.category !== "Accessory")
        .every((l) => l.tracksSerial),
    ).toBe(true);
    // No categories table: the safe direction, every line tracks serials.
    const bare = inventoryLines(
      db.units,
      { skus: db.skus, models: db.models },
      { costOf: total },
    );
    expect(bare.every((l) => l.tracksSerial)).toBe(true);
  });

  it("quantities follow the unit filter the page applied", () => {
    // The contract in the docblock: the caller narrows units, this counts what
    // is left. A quantity that ignored the filter would be a lie told next to
    // the filter that produced it. The band is CHOSEN from the data, so the
    // test holds the contract rather than the fixture hostage.
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
    const filtered = inventoryLines(narrowed, db, { costOf: total });
    const held = filtered.reduce((t, l) => t + l.onHand, 0);
    expect(held).toBe(
      narrowed.filter((u) => HELD_STATUSES.includes(u.status)).length,
    );
    for (const l of filtered) {
      expect(l.units.every((u) => bandOf(u) === band)).toBe(true);
    }
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

  it("never records a unit in the other era's reading", () => {
    // One battery, one set of numbers. A unit carrying both would let two
    // columns disagree about the same unit.
    for (const u of seeded.units) {
      const mode = readUnitBattery(u, seeded).mode;
      if (mode === "CYCLES") expect(u.batteryHealth, u.serial).toBeUndefined();
      else expect(u.cycleCount, u.serial).toBeUndefined();
    }
  });
});
