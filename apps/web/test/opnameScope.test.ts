/**
 * What a stock take covers — `lib/opnameScope.ts`.
 *
 * The rule the whole feature rests on is that an empty axis means ALL, not
 * none. Getting it the other way round would not throw and would not look
 * wrong: a count would simply expect nothing, report nothing missing, and
 * quietly confirm that the shop had lost nothing. So most of this file is one
 * assertion made four times, on purpose.
 */
import { describe, expect, it } from "vitest";
import {
  WHOLE_SHOP,
  inOpnameScope,
  isWholeShop,
  scopeOf,
  soleLocation,
} from "../src/lib/opnameScope.js";
import type { Unit } from "../src/mock/seed.js";

const unit = (over: Partial<Unit> = {}): Unit => ({
  serial: "ASBJ347203KLM",
  skuId: "sku-air",
  status: "TERSEDIA",
  locationId: "wh-1",
  rackId: "rk-1",
  buy: 0,
  description: "",
  poId: null,
  ...over,
});

/** Air is a MacBook Air, Pad is an iPad. Anything else has no category. */
const categoryOf = (skuId: string) =>
  ({ "sku-air": "MacBook Air", "sku-pad": "iPad" })[skuId];

describe("empty means all", () => {
  it("puts every machine inside a scope that names nothing", () => {
    expect(inOpnameScope(unit(), WHOLE_SHOP, categoryOf)).toBe(true);
    expect(
      inOpnameScope(
        unit({ locationId: "wh-9", rackId: undefined, skuId: "sku-pad" }),
        WHOLE_SHOP,
        categoryOf,
      ),
    ).toBe(true);
  });

  it("is what `isWholeShop` reports", () => {
    expect(isWholeShop(WHOLE_SHOP)).toBe(true);
    expect(isWholeShop({ ...WHOLE_SHOP, categories: ["iPad"] })).toBe(false);
  });

  it("reads a record written before the axes existed as the whole shop", () => {
    // Not a migration — the mock reboots from the seed — but the seeded count
    // and anything an older build wrote must not throw on `undefined.length`.
    expect(isWholeShop(scopeOf({}))).toBe(true);
    expect(scopeOf({ locationIds: ["wh-1"] })).toEqual({
      locationIds: ["wh-1"],
      rackIds: [],
      categories: [],
      conditions: [],
    });
  });
});

describe("each axis on its own", () => {
  it("warehouse", () => {
    const scope = { ...WHOLE_SHOP, locationIds: ["wh-1", "wh-2"] };
    expect(inOpnameScope(unit({ locationId: "wh-2" }), scope, categoryOf)).toBe(
      true,
    );
    expect(inOpnameScope(unit({ locationId: "wh-3" }), scope, categoryOf)).toBe(
      false,
    );
  });

  it("rack", () => {
    const scope = { ...WHOLE_SHOP, rackIds: ["rk-1"] };
    expect(inOpnameScope(unit({ rackId: "rk-1" }), scope, categoryOf)).toBe(
      true,
    );
    expect(inOpnameScope(unit({ rackId: "rk-2" }), scope, categoryOf)).toBe(
      false,
    );
  });

  it("category", () => {
    const scope = { ...WHOLE_SHOP, categories: ["iPad"] };
    expect(inOpnameScope(unit({ skuId: "sku-pad" }), scope, categoryOf)).toBe(
      true,
    );
    expect(inOpnameScope(unit({ skuId: "sku-air" }), scope, categoryOf)).toBe(
      false,
    );
    // A SKU whose category cannot be resolved is not in a category count.
    expect(inOpnameScope(unit({ skuId: "sku-???" }), scope, categoryOf)).toBe(
      false,
    );
  });

  it("condition, which is read off the grade", () => {
    // `lib/condition.ts`: NEW is sealed, everything else — ungraded included —
    // is second-hand.
    const sealed = { ...WHOLE_SHOP, conditions: ["NEW" as const] };
    expect(inOpnameScope(unit({ grade: "NEW" }), sealed, categoryOf)).toBe(
      true,
    );
    expect(inOpnameScope(unit({ grade: "A" }), sealed, categoryOf)).toBe(false);
    expect(inOpnameScope(unit({ grade: undefined }), sealed, categoryOf)).toBe(
      false,
    );

    const second = { ...WHOLE_SHOP, conditions: ["SECOND" as const] };
    expect(inOpnameScope(unit({ grade: undefined }), second, categoryOf)).toBe(
      true,
    );
  });
});

describe("the axes are ANDed", () => {
  it("means the iPads in Gudang Utama, not the iPads plus Gudang Utama", () => {
    const scope = {
      ...WHOLE_SHOP,
      locationIds: ["wh-1"],
      categories: ["iPad"],
    };
    expect(
      inOpnameScope(
        unit({ locationId: "wh-1", skuId: "sku-pad" }),
        scope,
        categoryOf,
      ),
    ).toBe(true);
    // An iPad somewhere else, and a MacBook here, are both out.
    expect(
      inOpnameScope(
        unit({ locationId: "wh-2", skuId: "sku-pad" }),
        scope,
        categoryOf,
      ),
    ).toBe(false);
    expect(
      inOpnameScope(
        unit({ locationId: "wh-1", skuId: "sku-air" }),
        scope,
        categoryOf,
      ),
    ).toBe(false);
  });

  it("counts all racks of a warehouse when none is named — the owner's example", () => {
    // *"Warehouse 1 and not choosing which rack, so assume it's all rack in
    // warehouse 1"*.
    const scope = { ...WHOLE_SHOP, locationIds: ["wh-1"] };
    for (const rackId of ["rk-1", "rk-2", undefined]) {
      expect(inOpnameScope(unit({ rackId }), scope, categoryOf)).toBe(true);
    }
  });
});

describe("a machine with no rack", () => {
  it("is left out once racks are named, because it is on no shelf", () => {
    // Units in QC have no `rackId` — QC gives a machine its shelf when it
    // accepts it. A count of two racks is a count of what is on them.
    expect(
      inOpnameScope(
        unit({ rackId: undefined, status: "QC" }),
        { ...WHOLE_SHOP, rackIds: ["rk-1"] },
        categoryOf,
      ),
    ).toBe(false);
  });

  it("is still expected by a count that names no rack", () => {
    expect(
      inOpnameScope(
        unit({ rackId: undefined, status: "QC" }),
        { ...WHOLE_SHOP, locationIds: ["wh-1"] },
        categoryOf,
      ),
    ).toBe(true);
  });
});

describe("soleLocation", () => {
  it("answers only when the count names exactly one warehouse", () => {
    expect(soleLocation({ ...WHOLE_SHOP, locationIds: ["wh-1"] })).toBe("wh-1");
  });

  it("declines to guess otherwise, which is what makes the field required", () => {
    // A surplus machine's warehouse is the one fact a stock take exists to
    // establish. Defaulting it to whichever sorted first would invent it.
    expect(soleLocation(WHOLE_SHOP)).toBeUndefined();
    expect(
      soleLocation({ ...WHOLE_SHOP, locationIds: ["wh-1", "wh-2"] }),
    ).toBeUndefined();
  });
});
