import { describe, expect, it } from "vitest";
import {
  matchLeaf,
  navTrail,
  NAV_SECTIONS,
} from "../src/layouts/navigation.js";
import { buildSeed } from "../src/mock/seed.js";

describe("navigation", () => {
  it("longest prefix wins — /discounts/new is Add, not Manage", () => {
    expect(matchLeaf("/discounts/new")?.leaf?.label).toBe("Add Discount");
    expect(matchLeaf("/discounts")?.leaf?.label).toBe("Manage Discounts");
  });
  it("breadcrumb trail is section then leaf", () => {
    expect(navTrail("/stock/opname")).toEqual(["Stock", "Stock Opname"]);
    expect(navTrail("/settings")).toEqual(["Settings"]);
    expect(navTrail("/nowhere")).toEqual([]);
  });
  it("every leaf path is unique", () => {
    const paths = NAV_SECTIONS.flatMap(
      (s) => s.children?.map((c) => c.path) ?? [s.path],
    );
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("mock seed", () => {
  const db = buildSeed();
  it("every non-QC unit carries a positive price (mirrors the DB CHECK)", () => {
    for (const u of db.units.filter((x) => x.status !== "QC")) {
      expect(u.price ?? 0).toBeGreaterThan(0);
    }
  });
  it("every unit's history starts with DITERIMA", () => {
    for (const u of db.units) {
      const first = db.events
        .filter((e) => e.serial === u.serial)
        .sort((a, b) => a.seq - b.seq)[0];
      expect(first?.type).toBe("DITERIMA");
    }
  });
  it("shopee order is pending until withdrawn", () => {
    const shopee = db.orders.find((o) => o.source === "SHOPEE");
    expect(shopee?.settled).toBe(false);
  });
});
