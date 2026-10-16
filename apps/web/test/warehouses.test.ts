/**
 * A warehouse is printed as its number and its name (owner ask 2026-10-08:
 * the shop has called them 01–04 for six years).
 */
import { describe, expect, it } from "vitest";
import {
  warehouseCode,
  warehouseLabel,
  warehouseLabelOf,
} from "../src/lib/warehouses.js";

describe("warehouseLabel", () => {
  it("puts the shop's number before the name", () => {
    expect(warehouseLabel({ id: "wh-01", code: "01", name: "Gudang" })).toBe(
      "01 · Gudang",
    );
  });

  it("is the name alone when there is no number", () => {
    expect(warehouseLabel({ id: "wh-1", name: "Gudang" })).toBe("Gudang");
    expect(warehouseLabel({ id: "wh-1", code: " ", name: "Gudang" })).toBe(
      "Gudang",
    );
  });

  it("does not print an id the store copied into the code", () => {
    // A warehouse made without a number has its id in `Location.code`.
    expect(warehouseCode({ id: "wh-7", code: "wh-7", name: "Gudang" })).toBe(
      undefined,
    );
    expect(warehouseLabel({ id: "wh-7", code: "wh-7", name: "Gudang" })).toBe(
      "Gudang",
    );
  });

  it("finds a warehouse by id, and answers nothing for an unknown one", () => {
    const all = [{ id: "wh-02", code: "02", name: "Toko" }];
    expect(warehouseLabelOf(all, "wh-02")).toBe("02 · Toko");
    expect(warehouseLabelOf(all, "wh-99")).toBeUndefined();
    expect(warehouseLabelOf(all, undefined)).toBeUndefined();
  });
});
