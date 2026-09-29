/**
 * What makes a customer record enough to collect a debt from, and what the
 * app calls them (owner ask 2026-09-24: *"they need to add names or phone
 * number (either is fine)"*).
 */
import { describe, expect, it } from "vitest";
import {
  customerLabel,
  customerLine,
  hasContact,
} from "../src/lib/customers.js";

describe("a customer is a name or a phone number", () => {
  it("is enough with either, and nothing with neither", () => {
    expect(hasContact({ name: "Budi", phone: "" })).toBe(true);
    expect(hasContact({ name: "", phone: "+62811223344" })).toBe(true);
    // The B2Soft customers: a name and no number.
    expect(hasContact({ name: "Budi" })).toBe(true);
    expect(hasContact({ name: "  ", phone: " " })).toBe(false);
    expect(hasContact({})).toBe(false);
    expect(hasContact({ name: null, phone: null })).toBe(false);
  });

  it("is called by name, or by number when that is all there is", () => {
    expect(customerLabel({ name: "Budi", phone: "+62811223344" })).toBe("Budi");
    expect(customerLabel({ name: "", phone: "+62811223344" })).toBe(
      "+62811223344",
    );
    expect(customerLabel({ name: " Budi ", phone: "" })).toBe("Budi");
    expect(customerLabel({})).toBe("");
  });

  it("lists name and number for a picker, without printing one twice", () => {
    expect(customerLine({ name: "Budi", phone: "+62811223344" })).toBe(
      "Budi · +62811223344",
    );
    expect(customerLine({ name: "Budi", phone: "" })).toBe("Budi");
    expect(customerLine({ name: "", phone: "+62811223344" })).toBe(
      "+62811223344",
    );
    // A label already resolved to the number, handed back with the number.
    expect(customerLine({ name: "+62811223344", phone: "+62811223344" })).toBe(
      "+62811223344",
    );
  });
});
