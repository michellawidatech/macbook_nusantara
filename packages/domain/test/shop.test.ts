import { describe, expect, it } from "vitest";
import { SHOP_ADDRESS, SHOP_PHONE } from "../src/shop.js";

describe("the shop's own address", () => {
  it("is the one the owner gave", () => {
    expect(SHOP_ADDRESS).toMatch(/^Ruko Sorrento Place/);
    expect(SHOP_PHONE).toBe("0858-8842-9991");
  });
});
