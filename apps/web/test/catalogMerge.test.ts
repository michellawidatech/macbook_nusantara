/**
 * Merging the same product found twice (owner ask 2026-10-21). The fixture is
 * the owner's own screenshot: one MacBook Air 13" 2020 as three products.
 */
import { describe, expect, it } from "vitest";
import type { CatalogModel, MockDb, Sku, Unit } from "../src/mock/seed";
import {
  applyMerge,
  duplicateGroups,
  planMerge,
  matchAppleDb,
} from "../src/lib/catalogMerge";

const model = (
  id: string,
  name: string,
  axes: CatalogModel["axes"],
): CatalogModel => ({
  id,
  name,
  category: "MacBook Air",
  releaseYear: 2020,
  source: "MANUAL",
  axes,
});
const sku = (
  id: string,
  modelId: string,
  code: string,
  variantLabel: string,
): Sku => ({
  id,
  modelId,
  code,
  name: "",
  variantLabel,
  price: 0,
});
const unit = (serial: string, skuId: string, status: Unit["status"]): Unit =>
  ({
    serial,
    skuId,
    status,
    locationId: "wh-03",
    buy: 5_000_000,
    description: "",
    poId: "po-1",
  }) as Unit;

function shop(): MockDb {
  return {
    models: [
      model("full", 'MacBook Air 13" 2020', [
        { name: "Chip", values: ["i3", "i5"] },
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ]),
      model("short", 'AIR 13" 2020', [
        { name: "RAM", values: [] },
        { name: "SSD", values: [] },
      ]),
      model("i5", 'AIR 13" 2020 I5', [
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["512GB", "1TB"] },
      ]),
      model("other", 'MacBook Air 13" 2019', [
        { name: "RAM", values: ["8GB"] },
      ]),
    ],
    skus: [
      sku("f-i3-256", "full", 'AIR 13" 2020 I3 8/256', "i3 / 8GB / 256GB"),
      sku("f-i5-512", "full", 'AIR 13" 2020 I5 8/512', "i5 / 8GB / 512GB"),
      sku("x-i5-512", "i5", 'AIR 13" 2020 I5 8/512 (2)', "8GB · 512GB"),
      sku("x-i5-1tb", "i5", "SKU_ZZ1TB", "8GB / 1TB"),
      sku("x-i5-256", "i5", "SKU_ZZ256", "8GB / 256GB"),
      sku("o-1", "other", 'AIR 13" 2019 8', "8GB"),
    ],
    units: [
      unit("C02A", "f-i5-512", "TERSEDIA"),
      unit("C02B", "x-i5-512", "TERSEDIA"),
      unit("C02C", "x-i5-512", "TERJUAL"),
      unit("C02D", "x-i5-1tb", "QC"),
    ],
    stockMoves: [],
    stockIns: [],
    pos: [{ id: "po-1", items: [{ skuId: "x-i5-1tb" }] }],
    orders: [{ id: "o-1", lines: [], serials: ["C02C"] }],
    events: [],
  } as unknown as MockDb;
}

describe("duplicateGroups", () => {
  it("finds the three as one product and suggests the one named in full", () => {
    const groups = duplicateGroups(shop());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.target.id).toBe("full");
    expect(groups[0]!.models.map((m) => m.id).sort()).toEqual([
      "full",
      "i5",
      "short",
    ]);
  });

  it("forgets a pair a person marked as different", () => {
    const db = shop();
    db.models.find((m) => m.id === "short")!.notDuplicateOf = ["full"];
    expect(
      duplicateGroups(db)[0]!
        .models.map((m) => m.id)
        .sort(),
    ).toEqual(["full", "i5"]);
  });
});

describe("planMerge", () => {
  const plan = planMerge(shop(), "full", ["short", "i5"]);
  const step = (id: string) => plan.steps.find((s) => s.skuId === id)!;

  it("reads the processor out of the product name", () => {
    expect(step("x-i5-1tb")).toMatchObject({
      action: "MOVE",
      label: "i5 / 8GB / 1TB",
      code: 'AIR 13" 2020 I5 8/1TB',
    });
  });

  it("joins a variant the target already has, units with it", () => {
    expect(step("x-i5-512")).toMatchObject({
      action: "JOIN",
      intoSkuId: "f-i5-512",
      heldUnits: ["C02B"],
    });
  });

  it("drops a duplicate that never held anything", () => {
    const db = shop();
    db.skus.push(sku("x-i3-256", "short", "SKU_DUP", "i3 · 8GB · 256GB"));
    db.models.find((m) => m.id === "short")!.axes = [
      { name: "Chip", values: ["i3"] },
      { name: "RAM", values: ["8GB"] },
      { name: "SSD", values: ["256GB"] },
    ];
    const p = planMerge(db, "full", ["short"]);
    expect(p.steps[0]).toMatchObject({ action: "DROP", intoSkuId: "f-i3-256" });
    // i5 8/256 is new to the target, so it moves rather than drops.
    expect(step("x-i5-256").action).toBe("MOVE");
    expect(plan.stuck).toBe(false);
    expect(plan.axes.find((a) => a.name === "SSD")!.values).toEqual([
      "256GB",
      "512GB",
      "1TB",
    ]);
  });

  it("writes it: units moved with a timeline line, the sold unit stays, the empties archived", () => {
    const d = shop();
    let n = 0;
    applyMerge(d, plan, {
      nextId: (p) => `${p}-${++n}`,
      appendEvent: (db, serial, ev) =>
        db.events.push({
          serial,
          ...ev,
        } as unknown as MockDb["events"][number]),
      staff: "Ersen",
      now: "2026-10-21T10:00:00.000Z",
    });
    expect(d.models.map((m) => m.id).sort()).toEqual(["full", "other"]);
    expect(d.units.find((u) => u.serial === "C02B")!.skuId).toBe("f-i5-512");
    // Sold: its receipt names the old variant, which is kept and marked.
    expect(d.units.find((u) => u.serial === "C02C")!.skuId).toBe("x-i5-512");
    expect(d.skus.find((s) => s.id === "x-i5-512")).toMatchObject({
      mergedIntoId: "f-i5-512",
      modelId: "full",
    });
    // Moved: same id, so the QC unit and its invoice line still point at it.
    expect(d.skus.find((s) => s.id === "x-i5-1tb")).toMatchObject({
      modelId: "full",
      code: 'AIR 13" 2020 I5 8/1TB',
    });
    expect(d.units.find((u) => u.serial === "C02D")!.skuId).toBe("x-i5-1tb");
    expect(d.events).toEqual([
      expect.objectContaining({ serial: "C02B", type: "DICATAT" }),
    ]);
    expect(d.models.find((m) => m.id === "full")!.family).toBe("MacBook Air");
  });

  it("stops when a target variant would need a value nobody gave", () => {
    const db = shop();
    // The RAM × SSD product as target, the processor-named one merged in: its
    // own variants would need a processor.
    db.skus.push(sku("s-1", "short", 'AIR 13" 2020 8/256', "8GB / 256GB"));
    expect(planMerge(db, "short", ["i5"]).stuck).toBe(true);
  });
});

describe("matchAppleDb — AppleDB does not re-add what is there", () => {
  const db = shop();
  it("links an entry to the product typed in by hand", () => {
    const m = matchAppleDb(db, {
      name: "MacBook Air (Retina, 13-inch, 2020)",
      releaseYear: 2020,
      identifier: "MacBookAir9,1",
      chip: "i5",
    });
    expect(m.status === "MATCH" && m.model.id).toBe("full");
  });
  it("knows an identifier already linked", () => {
    const linked = shop();
    linked.models[0]!.identifiers = ["MacBookAir9,1"];
    expect(
      matchAppleDb(linked, {
        name: "anything",
        releaseYear: 2020,
        identifier: "MacBookAir9,1",
      }).status,
    ).toBe("LINKED");
  });
  it("says new for a machine not in the catalogue", () => {
    expect(
      matchAppleDb(db, {
        name: "MacBook Pro (14-inch, M3 Pro, 2023)",
        releaseYear: 2023,
        identifier: "Mac15,6",
        chip: "M3 Pro",
      }).status,
    ).toBe("NEW");
  });
});
