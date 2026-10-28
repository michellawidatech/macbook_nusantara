import { describe, expect, it } from "vitest";
import {
  GRADE_LADDER,
  UNIT_FAULT_PHRASES,
  offerLadder,
  servicedState,
  splitCondition,
  type LadderUnit,
} from "../src/unitCondition.js";

describe("splitCondition — faults said upfront, marks only when asked", () => {
  it("splits the QC description into faults and marks, keeping its order", () => {
    expect(splitCondition("Lecet halus, Baterai lemah, Unit only")).toEqual({
      faults: ["Baterai lemah", "Unit only"],
      marks: ["Lecet halus"],
    });
  });

  it("matches a fault whatever its case and spacing, and keeps the casing", () => {
    expect(splitCondition("  baterai LEMAH ")).toEqual({
      faults: ["baterai LEMAH"],
      marks: [],
    });
  });

  it("treats a phrase nobody listed as a mark", () => {
    expect(splitCondition("Dent di sudut,Sudah ganti SSD")).toEqual({
      faults: [],
      marks: ["Dent di sudut", "Sudah ganti SSD"],
    });
  });

  it.each([null, undefined, "", " , ,  "])("says nothing for %j", (d) => {
    expect(splitCondition(d)).toEqual({ faults: [], marks: [] });
  });

  it("lists the six functional faults and missing items", () => {
    expect(UNIT_FAULT_PHRASES).toEqual([
      "Layar ada garis",
      "Keyboard aus",
      "Engsel longgar",
      "Baterai lemah",
      "Tanpa charger",
      "Unit only",
    ]);
  });
});

describe("servicedState — unknown is never a promise", () => {
  it("is yes once the unit has a service visit, whatever QC said", () => {
    expect(servicedState({ neverServiced: true, visits: 1 })).toBe("yes");
  });
  it("is yes when QC said it has been opened", () => {
    expect(servicedState({ neverServiced: false, visits: 0 })).toBe("yes");
  });
  it("is never when QC said so and nothing since contradicts it", () => {
    expect(servicedState({ neverServiced: true, visits: 0 })).toBe("never");
  });
  it.each([null, undefined])("is undefined when QC left it blank (%j)", (n) => {
    expect(servicedState({ neverServiced: n, visits: 0 })).toBeUndefined();
  });
});

describe("offerLadder — cheapest grade first", () => {
  const u = (
    serial: string,
    grade: string | null | undefined,
    price: bigint | null,
    skuId = "air-m2",
  ): LadderUnit => ({ serial, grade, price, skuId });

  it("runs C → B → A → NEW", () => {
    expect(GRADE_LADDER).toEqual(["C", "B", "A", "NEW"]);
  });

  it("leads with the cheapest unit of the lowest grade and lists the other grades", () => {
    const a = u("A1", "A", 12_000_000n);
    const c1 = u("C1", "C", 10_000_000n);
    const c2 = u("C2", "C", 9_500_000n);
    const b = u("B1", "B", null);
    const other = u("X1", "C", 1_000n, "pro-m3");
    const ladder = offerLadder([a, c1, c2, b, other], "air-m2");
    expect(ladder.lead).toBe(c2);
    expect(ladder.grades).toEqual([
      { grade: "B", from: null, count: 1, unit: b },
      { grade: "A", from: 12_000_000n, count: 1, unit: a },
    ]);
  });

  it("counts every unit of a grade and quotes its cheapest, an unpriced one last", () => {
    const c = u("C1", "C", 9_000_000n);
    const aNull = u("A0", "A", null);
    const aDear = u("A2", "A", 13_000_000n);
    const aCheap = u("A1", "A", 12_000_000n);
    const ladder = offerLadder([aNull, aDear, c, aCheap], "air-m2");
    expect(ladder.lead).toBe(c);
    expect(ladder.grades).toEqual([
      { grade: "A", from: 12_000_000n, count: 3, unit: aCheap },
    ]);
  });

  it("puts a grade it does not know after NEW", () => {
    const n = u("N1", "NEW", 20_000_000n);
    const odd = u("Z1", "Z", 5_000_000n);
    const none = u("Q1", null, 4_000_000n);
    const ladder = offerLadder([odd, none, n], "air-m2");
    expect(ladder.lead).toBe(n);
    expect(ladder.grades.map((g) => g.grade)).toEqual(["", "Z"]);
  });

  it("breaks a tie on price by serial, so the same shelf leads the same way", () => {
    const b2 = u("B2", "B", 8_000_000n);
    const b1 = u("B1", "B", 8_000_000n);
    expect(offerLadder([b2, b1], "air-m2").lead).toBe(b1);
    expect(offerLadder([b1, b2], "air-m2").lead).toBe(b1);
  });

  it("orders two unpriced units by serial too", () => {
    const b2 = u("B2", "B", null);
    const b1 = u("B1", "B", null);
    const priced = u("B3", "B", 1n);
    expect(offerLadder([b2, b1], "air-m2").lead).toBe(b1);
    expect(offerLadder([b2, priced], "air-m2").lead).toBe(priced);
  });

  it("gives the same lead whichever order the shelf arrives in", () => {
    const unpriced = u("B9", "B", null);
    const cheap = u("B5", "B", 7_000_000n);
    const dear = u("B1", "B", 9_000_000n);
    for (const shelf of [
      [unpriced, cheap],
      [cheap, unpriced],
      [dear, cheap],
      [cheap, dear],
    ])
      expect(offerLadder(shelf, "air-m2").lead).toBe(cheap);
  });

  it("has nothing to offer for an empty shelf or another variant's units", () => {
    expect(offerLadder([], "air-m2")).toEqual({ lead: null, grades: [] });
    expect(offerLadder([u("X1", "A", 1n, "pro-m3")], "air-m2")).toEqual({
      lead: null,
      grades: [],
    });
  });

  it("keeps the caller's own unit shape", () => {
    const rich = { serial: "C1", grade: "C", price: 1n, skuId: "s", photos: 2 };
    expect(offerLadder([rich], "s").lead?.photos).toBe(2);
  });
});
