import { describe, expect, it } from "vitest";
import {
  fullModelName,
  fullNameRenames,
  identityKey,
  modelIdentity,
  modelKeyOf,
  productKeyOf,
  variantKeyOf,
} from "../src/catalogIdentity.js";

describe("modelIdentity", () => {
  it("reads one product however it was typed (owner screenshot 2026-10-21)", () => {
    const names = [
      'MacBook Air 13" 2020',
      'AIR 13" 2020',
      'AIR 13" 2020 I5 8/256',
    ];
    const keys = names.map((n) => identityKey(modelIdentity(n, 2020)!));
    expect(new Set(keys).size).toBe(1);
    expect(modelIdentity('AIR 13" 2020 I5', 2020)!.intelChip).toBe("i5");
  });

  it("keeps an extra, once, and reads AppleDB's hyphenated size", () => {
    expect(modelIdentity('PRO 13" 2017 TB 8/256 TB', 2017)).toEqual({
      family: "MacBook Pro",
      sizeInch: 13,
      era: "2017",
      extra: "TB",
    });
    expect(modelIdentity("MacBook Air (Retina, 13-inch, 2020)")!.sizeInch).toBe(
      13,
    );
    expect(modelIdentity("iPad mini 6 GEN 2021")!.extra).toBe("6 GEN");
    expect(modelIdentity('AIR 13,3" 2017')!.sizeInch).toBe(13.3);
  });

  it("names Apple silicon by its chip, and a 2016 m3 by its year", () => {
    expect(modelIdentity('AIR 13" M2 8/256')!.era).toBe("M2");
    expect(modelIdentity('AIR 12" 2016 M3')).toMatchObject({
      era: "2016",
      intelChip: "m3",
    });
  });

  it("takes the year from the model when the name has none", () => {
    expect(modelIdentity('MacBook Air 13"', 2019)!.era).toBe("2019");
    expect(modelIdentity('MacBook Air 13"', "")).toBeNull();
    expect(modelIdentity('MacBook Air 13"')).toBeNull();
  });

  it("knows every line, and nothing else", () => {
    for (const [name, family] of [
      ['MacBook 12" 2017', "MacBook"],
      ['iMac Pro 27" 2017', "iMac Pro"],
      ['iMac 24" M1', "iMac"],
      ["Mac mini M2", "Mac mini"],
      ["Mac Studio M2 Max", "Mac Studio"],
      ["Mac Pro 2019", "Mac Pro"],
      ['iPad Air 13" M3', "iPad Air"],
      ['IPAD PRO 13" M4 256', "iPad Pro"],
      ['iPad 10.9" 2022', "iPad"],
      ['PRO 14" M3 PRO', "MacBook Pro"],
    ] as const) {
      expect(modelIdentity(name)!.family).toBe(family);
    }
    expect(modelIdentity("Magic Mouse")).toBeNull();
  });
});

describe("fullModelName", () => {
  it("prints the full name", () => {
    expect(fullModelName(modelIdentity('AIR 13" 2020 I5', 2020)!)).toBe(
      'MacBook Air 13" 2020',
    );
    expect(fullModelName(modelIdentity('PRO 14" M3 PRO MAX')!)).toBe(
      'MacBook Pro 14" M3 Pro Max',
    );
    expect(fullModelName(modelIdentity("Mac mini M2")!)).toBe("Mac mini M2");
    expect(
      fullModelName({ family: "MacBook Air", sizeInch: 13.0, era: "2020" }),
    ).toBe('MacBook Air 13" 2020');
  });
});

describe("fullNameRenames", () => {
  it("renames only what is safe", () => {
    expect(
      fullNameRenames([
        { id: "a", name: 'AIR 13" M2', releaseYear: 2022 },
        { id: "b", name: 'MacBook Pro 14" M3', releaseYear: 2023 },
        { id: "c", name: 'AIR 13" 2020 I5', releaseYear: 2020 },
        { id: "d", name: 'AIR 13" 2019', releaseYear: 2019 },
        { id: "e", name: 'MacBook Air 13" 2019', releaseYear: 2019 },
        { id: "f", name: "Magic Mouse", releaseYear: 2020 },
      ]),
    ).toEqual([{ id: "a", from: 'AIR 13" M2', to: 'MacBook Air 13" M2' }]);
  });
});

describe("keys", () => {
  it("keys a product from its facts as from its name", () => {
    const fromName = identityKey(modelIdentity('AIR 13" M2')!);
    expect(
      productKeyOf({
        family: "MacBook Air",
        sizeInch: 13,
        year: 2022,
        chip: "m2",
      }),
    ).toBe(fromName);
    expect(
      productKeyOf({
        family: "MacBook Pro",
        sizeInch: 13,
        year: "2017",
        extra: "tb",
      }),
    ).toBe("MACBOOK PRO|13|2017|TB");
    expect(productKeyOf({ family: "Mac mini", year: 2018, chip: "i3" })).toBe(
      "MAC MINI||2018|",
    );
    expect(productKeyOf({ family: "", year: 2020 })).toBeNull();
    expect(productKeyOf({ family: "MacBook Air", year: null })).toBeNull();
    expect(productKeyOf({ family: "MacBook Air", year: "" })).toBeNull();
    expect(productKeyOf({ family: "MacBook Air", chip: "M2" })).toBe(
      "MACBOOK AIR||M2|",
    );
  });

  it("gives a processor-named model no key", () => {
    expect(modelKeyOf({ name: 'AIR 13" 2020 I5', year: 2020 })).toBeNull();
    expect(modelKeyOf({ name: 'AIR 13" 2020', year: 2020 })).toBe(
      "MACBOOK AIR|13|2020|",
    );
    expect(modelKeyOf({ name: "Magic Mouse" })).toBeNull();
    expect(
      modelKeyOf({
        name: "whatever",
        family: "MacBook Air",
        sizeInch: 13,
        year: 2020,
      }),
    ).toBe("MACBOOK AIR|13|2020|");
  });

  it("keys a variant whatever its separator", () => {
    expect(variantKeyOf("i3 · 8GB · 256GB")).toBe(
      variantKeyOf("i3 / 8 GB / 256GB"),
    );
    expect(variantKeyOf("")).toBeNull();
    expect(variantKeyOf(undefined)).toBeNull();
  });
});
