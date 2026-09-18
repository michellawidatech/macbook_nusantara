/**
 * Which products are identified one by one, and which are counted.
 *
 * `lib/serialTracking.ts` has the reasoning; what is pinned here is the
 * direction it fails in — an unknown category tracks serials — because that is
 * what keeps a MacBook from entering stock with nobody asked for its number.
 */
import { describe, expect, it } from "vitest";
import {
  categoryTracksSerial,
  countedCategories,
  countedSerial,
  isCountedSerial,
  skuTracksSerial,
  type TrackingCatalogue,
} from "../src/lib/serialTracking.js";

const cat: TrackingCatalogue = {
  categories: [
    { name: "MacBook Air", tracksSerial: true },
    { name: "Accessory", tracksSerial: false },
  ],
  models: [
    { id: "m-air", category: "MacBook Air" },
    { id: "m-case", category: "Accessory" },
    { id: "m-ghost", category: "Something Nobody Configured" },
  ],
  skus: [
    { id: "sku-air", modelId: "m-air" },
    { id: "sku-case", modelId: "m-case" },
    { id: "sku-ghost", modelId: "m-ghost" },
  ],
};

describe("categoryTracksSerial", () => {
  it("answers from the category, not from its name", () => {
    expect(categoryTracksSerial(cat, "MacBook Air")).toBe(true);
    expect(categoryTracksSerial(cat, "Accessory")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    // A category is born by somebody typing it on a product, so "accessory"
    // and "Accessory" are both in the wild.
    expect(categoryTracksSerial(cat, " accessory ")).toBe(false);
  });

  it("tracks anything it has never heard of", () => {
    // The safe direction. Being wrong this way costs one box somebody can
    // leave empty; the other way is a MacBook on a shelf with no serial.
    expect(categoryTracksSerial(cat, "Something Nobody Configured")).toBe(true);
    expect(categoryTracksSerial(cat, undefined)).toBe(true);
  });
});

describe("skuTracksSerial", () => {
  it("resolves a variant through its model", () => {
    expect(skuTracksSerial(cat, "sku-air")).toBe(true);
    expect(skuTracksSerial(cat, "sku-case")).toBe(false);
  });

  it("tracks a variant nobody has chosen yet", () => {
    // A fresh invoice line has no product. Asking for a serial is the right
    // default while the question is still open.
    expect(skuTracksSerial(cat, undefined)).toBe(true);
    expect(skuTracksSerial(cat, "")).toBe(true);
    expect(skuTracksSerial(cat, "sku-nope")).toBe(true);
  });

  it("tracks a model whose category was never configured", () => {
    expect(skuTracksSerial(cat, "sku-ghost")).toBe(true);
  });
});

describe("countedCategories", () => {
  it("names the ones the shop counts", () => {
    expect(countedCategories(cat)).toEqual(["Accessory"]);
  });
});

describe("the handle a counted item carries", () => {
  it("is recognisable as one the app minted", () => {
    // Anybody who meets one — on a timeline, in a search — should be able to
    // tell at a glance that it is not a number printed on anything.
    const s = countedSerial("sku-case-PI-2026/09-0001", 3);
    expect(isCountedSerial(s)).toBe(true);
    expect(s).toContain("SKU-CASE");
    expect(s.endsWith("-3")).toBe(true);
  });

  it("does not claim a real serial is one", () => {
    expect(isCountedSerial("SC02740137JKM")).toBe(false);
  });

  it("is stable, so retrying a refused commit mints no second set", () => {
    expect(countedSerial("sku-case", 1)).toBe(countedSerial("sku-case", 1));
    expect(countedSerial("sku-case", 1)).not.toBe(countedSerial("sku-case", 2));
  });
});
