/**
 * The shop's own product naming convention (owner ask 2026-09-21).
 *
 * Every name asserted here is a real row from `Master Data Tanpa Gudang.xlsx`
 * — B2Soft's master list, 371 products — so this file is a check against what
 * the shop actually types rather than against a convention somebody inferred.
 */
import { describe, expect, it } from "vitest";
import {
  isAppleSilicon,
  parseProductName,
  shopProductName,
} from "../src/productCode.js";

describe("shopProductName", () => {
  it("builds an Intel machine's name, year and all", () => {
    expect(
      shopProductName({
        line: "AIR",
        sizeInch: 13,
        year: "2020",
        chip: "i5",
        ram: "8GB",
        ssd: "256GB",
      }),
    ).toBe('AIR 13" 2020 I5 8/256');
  });

  it("puts the CHIP where an Intel machine has its year, and drops the year", () => {
    /*
     * The shop does not say "the 2022 Air", it says "the M2 Air". Printing
     * both would be a name nobody in the shop would recognise, and the year of
     * an M-series machine is the part nobody can remember.
     */
    expect(
      shopProductName({
        line: "AIR",
        sizeInch: 13,
        year: "2022",
        chip: "M2",
        ram: "16GB",
        ssd: "512GB",
      }),
    ).toBe('AIR 13" M2 16/512');
  });

  it("keeps TB and drops GB, so the largest drive cannot read as the smallest", () => {
    expect(
      shopProductName({
        line: "PRO",
        sizeInch: 16,
        year: "2019",
        chip: "i9",
        ram: "64GB",
        ssd: "8TB",
      }),
    ).toBe('PRO 16" 2019 I9 64/8TB');
  });

  it("carries the suffix that tells two otherwise identical machines apart", () => {
    expect(
      shopProductName({
        line: "PRO",
        sizeInch: 13,
        year: "2017",
        chip: "i5",
        ram: "8GB",
        ssd: "512GB",
        extra: "TB",
      }),
    ).toBe('PRO 13" 2017 I5 8/512 TB');
  });

  it("closes up around a missing part rather than leaving a gap", () => {
    expect(
      shopProductName({ line: "IPAD PRO", sizeInch: 13, ssd: "256GB" }),
    ).toBe('IPAD PRO 13" 256');
    expect(shopProductName({})).toBe("");
  });
});

describe("isAppleSilicon", () => {
  it("knows the chips the shop names a machine by", () => {
    for (const chip of ["M1", "M2", "M3 Pro", "m4", "M5"]) {
      expect(isAppleSilicon(chip), chip).toBe(true);
    }
    for (const chip of ["i5", "I9", "Core M", "", null, undefined]) {
      expect(isAppleSilicon(chip), String(chip)).toBe(false);
    }
  });
});

describe("parseProductName — reading B2Soft's own rows back", () => {
  it("reads an Intel MacBook", () => {
    expect(parseProductName('AIR 13" 2020 I5 8/256')).toEqual({
      line: "AIR",
      sizeInch: 13,
      year: "2020",
      chip: "I5",
      ram: "8GB",
      ssd: "256GB",
      recognised: true,
    });
  });

  it("reads an Apple-silicon MacBook, which has no year", () => {
    expect(parseProductName('AIR 13" M2 24/1TB')).toEqual({
      line: "AIR",
      sizeInch: 13,
      chip: "M2",
      ram: "24GB",
      ssd: "1TB",
      recognised: true,
    });
  });

  it("reads the touch-bar suffix without mistaking it for a terabyte", () => {
    // The terabyte is inside the configuration and has already been consumed,
    // so a bare TB after it is the touch bar.
    expect(parseProductName('PRO 13" 2017 I5 16/1TB NTB')).toMatchObject({
      ssd: "1TB",
      extra: "NTB",
    });
    expect(parseProductName('PRO 13" 2016 I5 8/256 TB')).toMatchObject({
      ssd: "256GB",
      extra: "TB",
    });
  });

  it("keeps the chip as the LINE when the shop names the machine by it", () => {
    // `M1 PRO 14"` is how the shop writes that machine. Inventing a line of
    // "PRO" would file it beside the Intel Pros.
    expect(parseProductName('M1 PRO MAX 16" 64/2TB')).toMatchObject({
      line: "M1 PRO MAX",
      sizeInch: 16,
      ram: "64GB",
      ssd: "2TB",
    });
  });

  it("reads the half-terabyte the 2018 Air really shipped with", () => {
    // The separator is kept as the shop types it. Rewriting `1,5TB` to
    // `1.5TB` would make the name that comes out of an import differ from the
    // one that went in, which is the one thing an import must not do.
    expect(parseProductName('AIR 13" 2018 I5 16/1,5TB')).toMatchObject({
      ram: "16GB",
      ssd: "1,5TB",
    });
    expect(shopProductName(parseProductName('AIR 13" 2018 I5 16/1,5TB'))).toBe(
      'AIR 13" 2018 I5 16/1,5TB',
    );
  });

  it("reads an iMac and an iPad", () => {
    expect(parseProductName('IMAC 27" 2020 I5 32/256')).toMatchObject({
      line: "IMAC",
      sizeInch: 27,
      year: "2020",
      chip: "I5",
    });
    expect(parseProductName('IPAD PRO 13" M4 256')).toMatchObject({
      line: "IPAD PRO",
    });
  });

  it("leaves an accessory or a spare part alone, and says it did", () => {
    /*
     * These follow no convention because there is nothing to configure about
     * them. The honest answer is the whole string as its own name.
     */
    for (const name of [
      "FLEXYBEL BATTERY A1708",
      "CONVERTER USB TYPE C",
      "JASA SERVICE",
      "KOLI",
      "MAGSAFE 2 85W",
    ]) {
      const parsed = parseProductName(name);
      expect(parsed.line, name).toBe(name);
      expect(parsed.recognised, name).toBe(false);
      expect(parsed.ram, name).toBeUndefined();
    }
  });

  it("round-trips: a parsed name rebuilds to itself", () => {
    // The property that makes the import safe. What comes out of B2Soft goes
    // back in unchanged, so nothing is renamed on the way through.
    for (const name of [
      'AIR 13" 2020 I5 8/256',
      'PRO 16" 2019 I9 64/8TB',
      'AIR 13" M2 16/512',
      'PRO 13" 2017 I5 8/512 TB',
      'IMAC 24" M3 16/1TB',
    ]) {
      expect(shopProductName(parseProductName(name)), name).toBe(name);
    }
  });

  it("says nothing about an empty name rather than guessing", () => {
    expect(parseProductName("   ")).toEqual({ line: "", recognised: false });
  });
});
