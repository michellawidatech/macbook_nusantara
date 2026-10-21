import { describe, expect, it } from "vitest";
import { freeSkuCode, isMachineSkuCode, skuCodeFor } from "../src/lib/skuCode";

describe("skuCodeFor — the shop's naming (2026-10-21)", () => {
  it("reads a Chip × RAM × SSD variant onto an Intel model", () => {
    const axes = ["Chip", "RAM", "SSD"];
    expect(
      skuCodeFor('MacBook Air 13" 2020', 2020, "i7 / 8GB / 128GB", axes),
    ).toBe('AIR 13" 2020 I7 8/128');
    expect(
      skuCodeFor('MacBook Air 13" 2020', 2020, "i3 / 16GB / 1TB", axes),
    ).toBe('AIR 13" 2020 I3 16/1TB');
  });

  it("reads a RAM × SSD variant, with or without axis names", () => {
    expect(
      skuCodeFor('MacBook Air 13" M2', 2022, "8GB / 256GB", ["RAM", "SSD"]),
    ).toBe('AIR 13" M2 8/256');
    expect(skuCodeFor('MacBook Pro 14" M3', 2023, "16GB / 512GB")).toBe(
      'PRO 14" M3 16/512',
    );
  });

  it("takes the year from the model when the name has none", () => {
    expect(skuCodeFor('MacBook Air 13"', 2020, "i5 / 8GB / 256GB")).toBe(
      'AIR 13" 2020 I5 8/256',
    );
  });

  it("lets the variant replace a configuration typed into the name", () => {
    expect(
      skuCodeFor('AIR 13" 2020 i7 16/256', 2020, "16GB / 256GB", [
        "RAM",
        "SSD",
      ]),
    ).toBe('AIR 13" 2020 I7 16/256');
    expect(
      skuCodeFor('AIR 13" 2020 i7 16/256', 2020, "8GB / 1TB", ["RAM", "SSD"]),
    ).toBe('AIR 13" 2020 I7 8/1TB');
    expect(
      skuCodeFor('MacBook Air 13" 2020 i7 16GB 256GB', 2020, "8GB / 512GB"),
    ).toBe('AIR 13" 2020 I7 8/512');
  });

  it("keeps an accessory's own words", () => {
    expect(skuCodeFor("Magic Mouse", undefined, "")).toBe("MAGIC MOUSE");
  });

  it("spots the machine-made codes and never clashes", () => {
    expect(isMachineSkuCode("SKU_18FQN1UTLADWLAI8")).toBe(true);
    expect(isMachineSkuCode('AIR 13" 2020 I7 8/128')).toBe(false);
    expect(freeSkuCode(new Set(["X"]), "X")).toBe("X (2)");
  });
});
