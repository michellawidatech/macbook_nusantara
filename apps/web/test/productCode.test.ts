import { describe, expect, it } from "vitest";
import { productCode, productCodeLines } from "../src/lib/productCode.js";

describe("productCode", () => {
  it("builds the owner's example exactly", () => {
    expect(
      productCode({
        line: "PRO",
        sizeInch: 13,
        year: "2017",
        chip: "i5",
        ram: "8GB",
        ssd: "128GB",
        extra: "NTB",
      }),
    ).toBe('PRO 13" 2017 i5 8/128 NTB');
  });

  it("drops GB but keeps TB, so the largest drive cannot read as the smallest", () => {
    expect(productCode({ ram: "16GB", ssd: "1TB" })).toBe("16/1TB");
  });

  it("trims a whole-number size but keeps a genuine fraction", () => {
    expect(productCode({ sizeInch: 13 })).toBe('13"');
    expect(productCode({ sizeInch: 13.3 })).toBe('13.3"');
  });

  describe("missing parts", () => {
    it("closes up rather than leaving a gap", () => {
      expect(
        productCode({ line: "AIR", year: "2020", ram: "8GB", ssd: "256GB" }),
      ).toBe("AIR 2020 8/256");
    });

    it("prints the capacity it knows instead of a dangling slash", () => {
      expect(productCode({ ram: "8GB" })).toBe("8");
      expect(productCode({ ssd: "256GB" })).toBe("256");
    });

    it("is empty when it knows nothing, rather than being whitespace", () => {
      expect(productCode({})).toBe("");
      expect(productCode({ line: null, chip: undefined })).toBe("");
    });

    it("ignores a part that is only whitespace", () => {
      expect(productCode({ line: "  ", year: "2017" })).toBe("2017");
    });
  });
});

describe("productCodeLines", () => {
  it("breaks before the chip, matching the label sketch", () => {
    expect(
      productCodeLines({
        line: "PRO",
        sizeInch: 13,
        year: "2017",
        chip: "i5",
        ram: "8GB",
        ssd: "128GB",
        extra: "NTB",
      }),
    ).toEqual(['PRO 13" 2017', "i5 8/128 NTB"]);
  });

  it("keeps the first line identical across variants of one model", () => {
    const model = { line: "PRO", sizeInch: 13, year: "2017" } as const;
    const [a] = productCodeLines({
      ...model,
      chip: "i5",
      ram: "8GB",
      ssd: "128GB",
    });
    const [b] = productCodeLines({
      ...model,
      chip: "i7",
      ram: "16GB",
      ssd: "512GB",
    });
    expect(a).toBe(b);
  });

  it("yields an empty second line for something with no configuration", () => {
    expect(productCodeLines({ line: "AIR", year: "2020" })).toEqual([
      "AIR 2020",
      "",
    ]);
  });
});
