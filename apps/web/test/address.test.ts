import { describe, expect, it } from "vitest";
import {
  ADDRESS_FIELDS,
  composeAddress,
  EMPTY_ADDRESS,
  missingAddressParts,
  type AddressParts,
} from "../src/lib/address.js";

const parts = (over: Partial<AddressParts> = {}): AddressParts => ({
  ...EMPTY_ADDRESS,
  ...over,
});

const full = parts({
  street: "Jl. Kaliurang KM 5 No. 21",
  village: "Caturtunggal",
  district: "Depok",
  city: "Sleman",
  province: "DI Yogyakarta",
  postcode: "55281",
});

describe("composeAddress", () => {
  it("joins the parts in Indonesian postal order", () => {
    expect(composeAddress(full)).toBe(
      "Jl. Kaliurang KM 5 No. 21, Caturtunggal, Depok, Sleman, DI Yogyakarta, 55281",
    );
  });

  it("drops blank parts instead of leaving empty segments", () => {
    // The whole reason the parts are composed rather than concatenated: a
    // half-filled address has to read as a short address, not as
    // "Jl. Mawar 3, , , Sleman, , ".
    expect(
      composeAddress(parts({ street: "Jl. Mawar 3", city: "Sleman" })),
    ).toBe("Jl. Mawar 3, Sleman");
  });

  it("trims whitespace, and treats a space-only field as blank", () => {
    expect(
      composeAddress(parts({ street: "  Jl. Mawar 3  ", village: "   " })),
    ).toBe("Jl. Mawar 3");
  });

  it("separates the notes with an em dash, not a comma", () => {
    // A courier's booking form takes the notes in a different box, and the
    // dash is where to cut.
    expect(composeAddress({ ...full, notes: "Ring the bell" })).toBe(
      "Jl. Kaliurang KM 5 No. 21, Caturtunggal, Depok, Sleman, DI Yogyakarta, 55281 — Ring the bell",
    );
  });

  it("returns the notes alone when nothing else is filled in", () => {
    expect(composeAddress(parts({ notes: "Ask at the front desk" }))).toBe(
      "Ask at the front desk",
    );
  });

  it("is empty for an empty address rather than a string of separators", () => {
    expect(composeAddress(EMPTY_ADDRESS)).toBe("");
  });
});

describe("missingAddressParts", () => {
  it("names what a courier cannot deliver without", () => {
    expect(missingAddressParts(EMPTY_ADDRESS)).toEqual([
      "Street and number",
      "City / regency",
      "Province",
      "Postcode",
    ]);
  });

  it("does not insist on a village or a district", () => {
    // Plenty of city addresses are found from the street and postcode alone,
    // so both are asked for and neither blocks a sale.
    expect(
      missingAddressParts(parts({ ...full, village: "", district: "" })),
    ).toEqual([]);
  });

  it("counts a space-only field as missing", () => {
    expect(missingAddressParts({ ...full, postcode: "   " })).toEqual([
      "Postcode",
    ]);
  });

  it("is empty for a complete address", () => {
    expect(missingAddressParts(full)).toEqual([]);
  });
});

describe("ADDRESS_FIELDS", () => {
  it("covers every key of AddressParts exactly once", () => {
    // The form, the composer and the completeness check all read this array.
    // A key missing from it is a field nobody can fill in; a duplicate is a
    // field rendered twice.
    const keys = ADDRESS_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(EMPTY_ADDRESS).sort());
  });

  it("gives every field a label and a placeholder", () => {
    for (const field of ADDRESS_FIELDS) {
      expect(field.label.length, `label for ${field.key}`).toBeGreaterThan(0);
      expect(
        field.placeholder.length,
        `placeholder for ${field.key}`,
      ).toBeGreaterThan(0);
    }
  });
});
