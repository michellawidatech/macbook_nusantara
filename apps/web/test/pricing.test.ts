/**
 * The bundle rule, and the substitute/complement split behind the suggestions.
 *
 * Both are rules a person will be asked to defend at the till — "why did it
 * only take Rp1.400.000 off when I bought three?" — so they are pinned here
 * rather than left to be re-derived from the UI. The two facts most worth
 * protecting: a bundle groups the DEAREST qualifying units first, and it never
 * charges more than the units would have cost separately.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildSeed, type Discount, type MockDb } from "../src/mock/seed.js";
import {
  bundleProgress,
  discountAmount,
  isRedeemable,
  scopeMatches,
  unusedBundles,
  type BasketLine,
} from "../src/lib/pricing.js";
import { recommendFor } from "../src/lib/recommend.js";

let db: MockDb;

/** The seeded "any 2 accessories for Rp1.000.000". */
const gearup = (d: MockDb) => d.discounts.find((x) => x.code === "GEARUP2")!;

/** The cheapest available unit of a given model, as a basket line. */
function lineFor(d: MockDb, modelId: string): BasketLine {
  const skuIds = d.skus.filter((s) => s.modelId === modelId).map((s) => s.id);
  const unit = d.units.find(
    (u) => skuIds.includes(u.skuId) && u.status === "TERSEDIA",
  )!;
  // The variant's price, since 2026-08-27. Every available unit of a SKU
  // quotes it, so "the cheapest one" is now a question about SKUs.
  return {
    serial: unit.serial,
    price: d.skus.find((s) => s.id === unit.skuId)!.price,
  };
}

beforeEach(() => {
  db = buildSeed();
});

describe("scopeMatches", () => {
  it('matches everything under "All products"', () => {
    const line = lineFor(db, "m-air-m2");
    expect(scopeMatches(db, "All products", line.serial)).toBe(true);
  });

  it("matches on a category name, which is what the form stores", () => {
    const sleeve = lineFor(db, "m-sleeve");
    expect(scopeMatches(db, "Accessory", sleeve.serial)).toBe(true);
    expect(scopeMatches(db, "MacBook Air", sleeve.serial)).toBe(false);
  });

  it("matches on a model name too", () => {
    const air = lineFor(db, "m-air-m2");
    expect(scopeMatches(db, "MacBook Air M2", air.serial)).toBe(true);
  });

  it("does not match a serial the shop has never held", () => {
    expect(scopeMatches(db, "Accessory", "NOT-A-SERIAL")).toBe(false);
  });
});

describe("bundleProgress", () => {
  it("forms no bundle from a single qualifying unit, and says what is missing", () => {
    const p = bundleProgress(db, gearup(db), [lineFor(db, "m-sleeve")]);
    expect(p).toMatchObject({
      qualifying: 1,
      perBundle: 2,
      complete: 0,
      shortBy: 1,
      saving: 0,
    });
  });

  it("takes the dearest qualifying units first when the basket has a spare", () => {
    // A keyboard, a mouse and a sleeve. One bundle of two at Rp1.000.000
    // should pair the two DEAREST and leave the sleeve at full price; pairing
    // the two cheapest would save a fraction of that. The figures come off the
    // seed rather than being written out, because what is being tested is
    // which two it picks, not what a Magic Keyboard costs this month.
    const keyboard = lineFor(db, "m-magic-keyboard");
    const mouse = lineFor(db, "m-magic-mouse");
    const basket = [keyboard, mouse, lineFor(db, "m-sleeve")];
    const p = bundleProgress(db, gearup(db), basket);
    expect(p.qualifying).toBe(3);
    expect(p.complete).toBe(1);
    expect(p.shortBy).toBe(1);
    expect(p.saving).toBe(keyboard.price + mouse.price - 1_000_000);
  });

  it("never turns a bundle into a surcharge when the units are cheaper anyway", () => {
    // Sleeve + hub is 560.000, under the Rp1.000.000 bundle price. A shop does
    // not get to charge the difference.
    const basket = [lineFor(db, "m-sleeve"), lineFor(db, "m-usbc-hub")];
    const p = bundleProgress(db, gearup(db), basket);
    expect(p.complete).toBe(1);
    expect(p.saving).toBe(0);
  });

  it("ignores units outside the scope", () => {
    const basket = [lineFor(db, "m-sleeve"), lineFor(db, "m-air-m2")];
    expect(bundleProgress(db, gearup(db), basket).qualifying).toBe(1);
  });
});

describe("discountAmount", () => {
  it("caps a percentage at its ceiling", () => {
    const d = db.discounts.find((x) => x.code === "MERDEKA10")!; // 10%, max 500.000
    const basket = [{ serial: "x", price: 10_000_000 }];
    expect(discountAmount(db, d, basket)).toBe(500_000);
  });

  it("never takes off more than the basket costs", () => {
    const d: Discount = {
      id: "d-test",
      code: "TOOBIG",
      name: "Too big",
      type: "NOMINAL",
      amountRp: 99_000_000,
      used: 0,
      active: true,
      scope: "All products",
    };
    expect(discountAmount(db, d, [{ serial: "x", price: 1_000_000 }])).toBe(
      1_000_000,
    );
  });

  it("routes a bundle through the bundle rule", () => {
    const keyboard = lineFor(db, "m-magic-keyboard");
    const mouse = lineFor(db, "m-magic-mouse");
    expect(discountAmount(db, gearup(db), [keyboard, mouse])).toBe(
      keyboard.price + mouse.price - 1_000_000,
    );
  });

  it("is zero for no discount at all", () => {
    expect(discountAmount(db, undefined, [{ serial: "x", price: 5_000 }])).toBe(
      0,
    );
  });
});

describe("isRedeemable", () => {
  it("rejects a code that is switched off, expired, or used up", () => {
    const base = gearup(db);
    expect(isRedeemable(base)).toBe(true);
    expect(isRedeemable({ ...base, active: false })).toBe(false);
    expect(isRedeemable({ ...base, toDate: "2020-01-01" })).toBe(false);
    expect(isRedeemable({ ...base, fromDate: "2999-01-01" })).toBe(false);
    expect(isRedeemable({ ...base, usageLimit: 2, used: 2 })).toBe(false);
  });
});

describe("unusedBundles", () => {
  it("flags a bundle the basket has earned but not claimed", () => {
    const basket = [
      lineFor(db, "m-magic-keyboard"),
      lineFor(db, "m-magic-mouse"),
    ];
    const flagged = unusedBundles(db, basket, undefined);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.discount.code).toBe("GEARUP2");
  });

  it("stays quiet about the bundle that is already applied", () => {
    const basket = [
      lineFor(db, "m-magic-keyboard"),
      lineFor(db, "m-magic-mouse"),
    ];
    expect(unusedBundles(db, basket, gearup(db).id)).toHaveLength(0);
  });

  it("stays quiet when the bundle would save nothing", () => {
    const basket = [lineFor(db, "m-sleeve"), lineFor(db, "m-usbc-hub")];
    expect(unusedBundles(db, basket, undefined)).toHaveLength(0);
  });
});

describe("recommendFor", () => {
  it("offers a dearer variant of the same machine as an upgrade", () => {
    const air = lineFor(db, "m-air-m2");
    const upgrades = recommendFor(db, [air]).filter(
      (r) => r.kind === "UPGRADE",
    );
    expect(upgrades.length).toBeGreaterThan(0);
    for (const u of upgrades) expect(u.price).toBeGreaterThan(air.price);
  });

  it("never calls one accessory an upgrade over a different one", () => {
    // A USB-C hub costs more than a sleeve. It is not a better sleeve.
    const sleeve = lineFor(db, "m-sleeve");
    expect(
      recommendFor(db, [sleeve]).filter((r) => r.kind === "UPGRADE"),
    ).toHaveLength(0);
  });

  it("never offers a MacBook Pro as an add-on to a MacBook Air", () => {
    // Different category, same RAM x SSD grid — an alternative, not an addition.
    const air = lineFor(db, "m-air-m2");
    const addons = recommendFor(db, [air]).filter((r) => r.kind === "ADDON");
    expect(addons.length).toBeGreaterThan(0);
    for (const a of addons) expect(a.title).not.toMatch(/MacBook/);
  });

  it("keeps offering accessories once one is on the sale, and flags the bundle", () => {
    const sleeve = lineFor(db, "m-sleeve");
    const addons = recommendFor(db, [sleeve]).filter((r) => r.kind === "ADDON");
    const accessories = addons.filter((a) => a.bundle !== undefined);
    expect(accessories.length).toBeGreaterThan(0);
    // The code, not a sentence about it: the phrasing moved to the call
    // site so it can go through `t()` — see `WhyReason`.
    expect(accessories[0]!.bundle?.code).toBe("GEARUP2");
  });

  it("only ever recommends serials that are actually in stock", () => {
    const air = lineFor(db, "m-air-m2");
    for (const r of recommendFor(db, [air])) {
      const unit = db.units.find((u) => u.serial === r.serial)!;
      expect(unit.status).toBe("TERSEDIA");
      // The price is the variant's, and a SKU always has one — so "in stock"
      // is now the whole claim, where it used to need "and priced" beside it.
      expect(db.skus.find((s) => s.id === unit.skuId)!.price).toBeGreaterThan(0);
    }
  });

  it("recommends nothing for an empty basket", () => {
    expect(recommendFor(db, [])).toHaveLength(0);
  });
});
