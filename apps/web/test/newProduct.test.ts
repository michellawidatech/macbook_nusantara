import { describe, expect, it } from "vitest";
import type { CatalogModel, Sku } from "../src/mock/seed";
import { familiesFor, planNewProduct } from "../src/lib/newProduct";
import { fullModelName, modelIdentity } from "../src/lib/modelName";

const model = (
  id: string,
  name: string,
  axes: CatalogModel["axes"] = [],
): CatalogModel => ({
  id,
  name,
  category: "MacBook Air",
  releaseYear: 2020,
  source: "MANUAL",
  axes,
});
const sku = (modelId: string, code: string, variantLabel: string): Sku => ({
  id: code,
  modelId,
  code,
  name: "",
  variantLabel,
  price: 0,
});

describe("modelIdentity — one product, however it was typed (2026-10-21)", () => {
  it("reads the three names in the owner's screenshot as one product", () => {
    for (const n of [
      'MacBook Air 13" 2020',
      'AIR 13" 2020',
      'AIR 13" 2020 I5',
    ]) {
      expect(fullModelName(modelIdentity(n, 2020)!)).toBe(
        'MacBook Air 13" 2020',
      );
    }
    expect(modelIdentity('AIR 13" 2020 I5', 2020)!.intelChip).toBe("i5");
  });

  it("keeps what makes a different product", () => {
    expect(fullModelName(modelIdentity('PRO 13" 2017 TB', 2017)!)).toBe(
      'MacBook Pro 13" 2017 TB',
    );
    expect(fullModelName(modelIdentity('AIR 13" M2 8/256', 2022)!)).toBe(
      'MacBook Air 13" M2',
    );
    expect(fullModelName(modelIdentity('MacBook Pro 14" M3 Pro', 2023)!)).toBe(
      'MacBook Pro 14" M3 Pro',
    );
    // A 2016 `M3` is an Intel Core m3: the year names the product.
    expect(fullModelName(modelIdentity('AIR 12" 2016 M3', 2016)!)).toBe(
      'MacBook Air 12" 2016',
    );
  });

  it("leaves accessories alone", () => {
    expect(modelIdentity("Magic Mouse")).toBeNull();
    expect(modelIdentity('BATTERY A1398 PRO 15" 2015')).toBeNull();
  });
});

describe("planNewProduct", () => {
  it("builds the full name and puts Intel processors in the variants", () => {
    const plan = planNewProduct(
      { models: [], skus: [] },
      {
        category: "MacBook Air",
        family: "MacBook Air",
        sizeInch: 13,
        releaseYear: 2020,
        processors: ["i5", "i7"],
        ram: ["8GB"],
        ssd: ["256GB"],
      },
    );
    expect(plan.name).toBe('MacBook Air 13" 2020');
    expect(plan.existing).toBeUndefined();
    expect(plan.variants.map((v) => v.code)).toEqual([
      'AIR 13" 2020 I5 8/256',
      'AIR 13" 2020 I7 8/256',
    ]);
  });

  it("names an Apple-silicon product by its chip", () => {
    const plan = planNewProduct(
      { models: [], skus: [] },
      {
        category: "MacBook Air",
        family: "MacBook Air",
        sizeInch: 13,
        releaseYear: 2022,
        appleChip: "m2",
        ram: ["8GB", "16GB"],
        ssd: ["256GB"],
      },
    );
    expect(plan.name).toBe('MacBook Air 13" M2');
    expect(plan.variants.map((v) => v.code)).toEqual([
      'AIR 13" M2 8/256',
      'AIR 13" M2 16/256',
    ]);
  });

  it("adds only the missing variants to a product that already exists", () => {
    const existing = model("m1", 'MacBook Air 13" 2020', [
      { name: "Chip", values: ["i3"] },
      { name: "RAM", values: ["8GB"] },
      { name: "SSD", values: ["256GB"] },
    ]);
    const plan = planNewProduct(
      {
        models: [model("m0", 'AIR 13" 2020 I5'), existing],
        skus: [sku("m1", 'AIR 13" 2020 I3 8/256', "i3 · 8GB · 256GB")],
      },
      {
        category: "MacBook Air",
        family: "MacBook Air",
        sizeInch: 13,
        releaseYear: 2020,
        processors: ["i3", "i5"],
        ram: ["8GB"],
        ssd: ["256GB"],
      },
    );
    expect(plan.existing?.id).toBe("m1");
    expect(plan.variants).toEqual([
      { label: "i5 / 8GB / 256GB", code: 'AIR 13" 2020 I5 8/256' },
    ]);
    expect(plan.axes[0]).toEqual({ name: "Chip", values: ["i3", "i5"] });
  });

  it("says so when everything asked for already exists", () => {
    const plan = planNewProduct(
      {
        models: [
          model("m1", 'AIR 13" 2020', [
            { name: "RAM", values: ["8GB"] },
            { name: "SSD", values: ["256GB"] },
          ]),
        ],
        skus: [sku("m1", 'AIR 13" 2020 8/256', "8GB / 256GB")],
      },
      {
        category: "MacBook Air",
        family: "MacBook Air",
        sizeInch: 13,
        releaseYear: 2020,
        ram: ["8GB"],
        ssd: ["256GB"],
      },
    );
    expect(plan.problem).toBe("EXISTS");
    expect(plan.name).toBe('MacBook Air 13" 2020');
  });

  it("refuses to mix processor variants into a product that has none", () => {
    const plan = planNewProduct(
      {
        models: [
          model("m1", 'MacBook Air 13" 2020', [
            { name: "RAM", values: ["8GB"] },
            { name: "SSD", values: ["256GB"] },
          ]),
        ],
        skus: [sku("m1", 'AIR 13" 2020 8/256', "8GB / 256GB")],
      },
      {
        category: "MacBook Air",
        family: "MacBook Air",
        sizeInch: 13,
        releaseYear: 2020,
        processors: ["i5"],
        ram: ["8GB"],
        ssd: ["256GB"],
      },
    );
    expect(plan.problem).toBe("AXES");
  });

  it("names an accessory by hand, one variant", () => {
    expect(familiesFor("Accessories")).toEqual([]);
    const plan = planNewProduct(
      { models: [], skus: [] },
      { category: "Accessories", releaseYear: 2026, name: "Magic Mouse 2" },
    );
    expect(plan.name).toBe("Magic Mouse 2");
    expect(plan.variants).toEqual([{ label: "", code: "MAGIC MOUSE 2" }]);
  });
});
