/**
 * `lib/buyBack.ts` — the one rule every door that takes a unit in shares
 * (owner 2026-11-17: "after a unit is sold they can buy it back, we don't
 * lock it").
 */
import { describe, expect, it } from "vitest";
import { canBuyBack, receiveInto } from "../src/lib/buyBack.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

const copy = (): MockDb => structuredClone(getDb());

describe("canBuyBack", () => {
  it("lets only a sold unit in again", () => {
    expect(canBuyBack({ status: "TERJUAL" })).toBe(true);
    for (const status of ["TERSEDIA", "QC", "SERVIS", "DIRESERVASI"] as const)
      expect(canBuyBack({ status })).toBe(false);
  });
});

describe("receiveInto", () => {
  const fresh = (serial: string) => ({
    serial,
    skuId: "sku-x",
    status: "QC" as const,
    locationId: "wh-1",
    buy: 5_000_000,
    description: "",
    poId: "po-new",
  });

  it("adds a serial the shop has never seen", () => {
    const d = copy();
    const n = d.units.length;
    expect(receiveInto(d, fresh("NEVERSEEN01"))).toBe(true);
    expect(d.units).toHaveLength(n + 1);
  });

  it("brings a sold unit back as the same row, still SOLD until its event", () => {
    const d = copy();
    const sold = d.units.find((u) => u.status === "TERJUAL")!;
    const n = d.units.length;
    expect(receiveInto(d, fresh(sold.serial))).toBe(true);
    expect(d.units).toHaveLength(n);
    expect(d.units.find((u) => u.serial === sold.serial)).toMatchObject({
      status: "TERJUAL",
      buy: 5_000_000,
      poId: "po-new",
      skuId: "sku-x",
    });
  });

  it("writes nothing for a unit the shop still holds", () => {
    const d = copy();
    const held = d.units.find((u) => u.status === "TERSEDIA")!;
    const was = structuredClone(held);
    expect(receiveInto(d, fresh(held.serial))).toBe(false);
    expect(d.units.find((u) => u.serial === held.serial)).toEqual(was);
  });
});
