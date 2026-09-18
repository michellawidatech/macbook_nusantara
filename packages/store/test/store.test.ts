import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyRows,
  comparable,
  decodeRow,
  diffStore,
  encodeChangeset,
  encodeRow,
  isEmptyChangeset,
  isProvisionalCode,
  provisionalCodesIn,
  replaceStrings,
  serverSchemas,
} from "../src/index.js";

const unit = (serial: string, extra: Record<string, unknown> = {}) => ({
  serial,
  skuId: "sku-1",
  status: "TERSEDIA",
  locationId: "wh-1",
  buy: 4_000_000,
  description: "Mulus",
  poId: null,
  ...extra,
});

describe("diffStore", () => {
  it("sees nothing when the mutation changed nothing", () => {
    const units = [unit("SC02AAA11111")];
    const before = { units };
    expect(isEmptyChangeset(diffStore(before, { units }))).toBe(true);
    // A new array holding the same rows is still no change.
    expect(isEmptyChangeset(diffStore(before, { units: [...units] }))).toBe(
      true,
    );
  });

  it("carries the base with a change, and nothing with an insert", () => {
    const a = unit("SC02AAA11111");
    const b = unit("SC02BBB22222");
    const change = diffStore(
      { units: [a] },
      { units: [{ ...a, status: "TERJUAL" }, b] },
    );
    const rows = change.collections.units!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: a.serial, base: a });
    expect(rows[0]!.next).toMatchObject({ status: "TERJUAL" });
    expect(rows[1]).toEqual({ key: b.serial, next: b, index: 1 });
  });

  it("reports a removal with its base and no next", () => {
    const a = unit("SC02AAA11111");
    const change = diffStore({ units: [a] }, { units: [] });
    expect(change.collections.units!.rows).toEqual([
      { key: a.serial, base: a },
    ]);
  });

  it("does not call an identical copy a change", () => {
    const a = unit("SC02AAA11111");
    const change = diffStore({ units: [a] }, { units: [{ ...a }] });
    expect(isEmptyChangeset(change)).toBe(true);
  });

  it("records a new order for an ordered list even when no row changed", () => {
    const r1 = {
      id: "r1",
      category: "MacBook Air",
      grade: "A",
      conditions: [],
    };
    const r2 = {
      id: "r2",
      category: "MacBook Air",
      grade: "C",
      conditions: [],
    };
    const change = diffStore(
      { gradingRules: [r1, r2] },
      { gradingRules: [r2, r1] },
    );
    expect(change.collections.gradingRules).toEqual({
      rows: [],
      order: ["r2", "r1"],
    });
  });

  it("refuses two rows with one key", () => {
    const a = unit("SC02AAA11111");
    expect(() => diffStore({ units: [] }, { units: [a, { ...a }] })).toThrow(
      /share the key/,
    );
  });

  it("diffs singletons by value", () => {
    const settings = { batteryGoodMin: 80, batteryFairMin: 76 };
    const same = diffStore({ settings }, { settings: { ...settings } });
    expect(isEmptyChangeset(same)).toBe(true);
    const moved = diffStore(
      { settings, myWarehouseId: "wh-1" },
      { settings, myWarehouseId: "wh-2" },
    );
    expect(moved.singletons).toEqual({
      myWarehouseId: { base: "wh-1", next: "wh-2" },
    });
  });
});

describe("the wire", () => {
  it("sends money as strings and brings it back as numbers", () => {
    const row = unit("SC02AAA11111", { price: 5_750_000 });
    const wire = encodeRow("units", row);
    expect(wire).toMatchObject({ buy: "4000000", price: "5750000" });
    expect(decodeRow("units", wire)).toEqual(row);
  });

  it("gives the server BigInt", () => {
    const wire = encodeRow("units", unit("SC02AAA11111"));
    const onServer = z.decode(serverSchemas.rows.units, wire as never);
    expect(onServer.buy).toBe(4_000_000n);
  });

  it("refuses a field nobody mapped, rather than dropping it", () => {
    expect(() =>
      encodeRow("units", unit("SC02AAA11111", { colour: "gold" })),
    ).toThrow();
  });

  it("carries a purchase line whose product has not been picked yet", () => {
    // Owner report 2026-09-15: refusing this row refused the whole commit,
    // and every edit queued behind it.
    const po = {
      id: "po-1",
      code: "PI-2026/09-000001",
      supplierId: "sup-1",
      invoice: "",
      date: "2026-09-15",
      locationId: "wh-1",
      items: [{ id: "poi-1", skuId: "", serial: null, qty: 1, unitCost: 0 }],
      payments: [],
      shippingFee: 0,
      taxFee: 0,
      discount: 0,
      status: "ORDERED",
    };
    expect(encodeRow("pos", po)).toMatchObject({
      items: [{ skuId: "", unitCost: "0" }],
    });
  });

  it("encodes every row of a changeset, base and next", () => {
    const a = unit("SC02AAA11111");
    const change = encodeChangeset(
      diffStore({ units: [a] }, { units: [{ ...a, buy: 4_100_000 }] }),
    );
    const row = change.collections.units!.rows[0]!;
    expect(row.base).toMatchObject({ buy: "4000000" });
    expect(row.next).toMatchObject({ buy: "4100000" });
  });
});

describe("comparable", () => {
  it("treats an absent flag and a false one as the same row", () => {
    expect(comparable({ id: "p", noInvoice: false, items: [] })).toBe(
      comparable({ id: "p" }),
    );
  });

  it("still sees a real change", () => {
    expect(comparable({ active: true })).not.toBe(
      comparable({ active: false }),
    );
    expect(comparable({ total: "10" })).not.toBe(comparable({ total: "11" }));
  });
});

describe("rows back into a list", () => {
  it("replaces in place, appends the new, drops the removed", () => {
    const a = unit("A0000000001");
    const b = unit("B0000000002");
    const c = unit("C0000000003");
    const out = applyRows(
      "units",
      [a, b],
      [{ ...a, status: "TERJUAL" }, c],
      [b.serial],
    );
    expect(out.map((u) => u["serial"])).toEqual([a.serial, c.serial]);
    expect(out[0]).toMatchObject({ status: "TERJUAL" });
  });
});

describe("provisional document codes", () => {
  it("recognises one and never a real number", () => {
    expect(isProvisionalCode("SI-2026/09-Tk3x9q2a")).toBe(true);
    expect(isProvisionalCode("SI-2026/09-000031")).toBe(false);
  });

  it("finds them inside notes, and replaces every occurrence", () => {
    const row = {
      code: "SI-2026/09-Tk3x9q2a",
      note: "Bargain on SI-2026/09-Tk3x9q2a: Rp5.000.000 → Rp4.800.000",
    };
    expect([...provisionalCodesIn(row)]).toEqual(["SI-2026/09-Tk3x9q2a"]);
    expect(
      replaceStrings(row, { "SI-2026/09-Tk3x9q2a": "SI-2026/09-000031" }),
    ).toEqual({
      code: "SI-2026/09-000031",
      note: "Bargain on SI-2026/09-000031: Rp5.000.000 → Rp4.800.000",
    });
  });
});
