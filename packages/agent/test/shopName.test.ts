import { describe, expect, it } from "vitest";
import { SHOP_NAME, renderStoreFacts, shopName } from "../src/systemFacts.js";

/**
 * "halo benar ini dengan macbook nusantara?" was handed to a person
 * (2026-10-27): the bot could not vouch for a name it was never given.
 */
describe("the shop's name", () => {
  it("is Macbook Nusantara when Settings has none or a demo name", () => {
    expect(shopName(null)).toBe(SHOP_NAME);
    expect(shopName("")).toBe(SHOP_NAME);
    expect(shopName("Toko Demo")).toBe(SHOP_NAME);
  });

  it("keeps a Settings name that names the shop", () => {
    expect(shopName("MacBook Nusantara Gading Serpong")).toBe(
      "MacBook Nusantara Gading Serpong",
    );
  });

  it("is always in the facts the bot reads", () => {
    const text = renderStoreFacts({
      name: shopName(null),
      contact: null,
      stores: [],
      paymentMethods: [],
      dp: { amount: 500_000, days: 7 },
    });
    expect(text).toContain("The shop is called Macbook Nusantara.");
  });
});
