import { describe, it, expect } from "vitest";
import { parseProduct, sizeTokens, skuWhere } from "./catalog.js";

/** The name words a filter requires (each matched against model name OR SKU name). */
const names = (where: ReturnType<typeof skuWhere>): string[] =>
  ((where.AND ?? []) as Array<Record<string, any>>)
    .filter((c) => c.OR)
    .map((c) => c.OR[1].name.contains);

const col = (where: ReturnType<typeof skuWhere>, column: "chip" | "storage"): string[] =>
  ((where.AND ?? []) as Array<Record<string, any>>)
    .filter((c) => c[column])
    .map((c) => c[column].contains);

describe("sizeTokens", () => {
  it("normalizes however the capacity was written", () => {
    expect(sizeTokens("16GB/512GB")).toEqual(["16GB", "512GB"]);
    expect(sizeTokens("16GB / 512GB")).toEqual(["16GB", "512GB"]);
    expect(sizeTokens("8 gb / 1tb")).toEqual(["8GB", "1TB"]);
    expect(sizeTokens(undefined)).toEqual([]);
  });
});

describe("parseProduct", () => {
  it("splits a pasted label into the columns that hold each part", () => {
    // Exactly what the customer echoed back in the conversation that failed.
    expect(parseProduct('MacBook Air 13" M2 16GB/512GB Grade B')).toEqual({
      nameTokens: ["MacBook", "Air", '13"'],
      chip: "M2",
      sizes: ["16GB", "512GB"],
      grade: "B",
    });
  });

  it("keeps a plain model name intact", () => {
    expect(parseProduct('MacBook Air 13"')).toEqual({
      nameTokens: ["MacBook", "Air", '13"'],
      chip: undefined,
      sizes: [],
      grade: undefined,
    });
  });

  it("handles a two-word chip and drops noise words", () => {
    const p = parseProduct('MacBook Pro 14" M3 Pro 18GB');
    expect(p.chip).toBe("M3 Pro");
    expect(p.nameTokens).toEqual(["MacBook", "Pro", '14"']);
    expect(parseProduct("iPad Air 11 inch").nameTokens).toEqual(["iPad", "Air", "11"]);
  });

  it("reads the grade wherever it sits, and never leaves the letter in the name", () => {
    expect(parseProduct("MacBook Air grade-c").grade).toBe("C");
    expect(parseProduct("MacBook Air grade-c").nameTokens).toEqual(["MacBook", "Air"]);
  });
});

describe("skuWhere", () => {
  it("requires every capacity separately, so '16GB/512GB' matches a stored '16GB / 512GB'", () => {
    expect(col(skuWhere({ product: "MacBook Air", storage: "16GB/512GB" }), "storage")).toEqual([
      "16GB",
      "512GB",
    ]);
    // The same query written with spaces, or as a single capacity.
    expect(col(skuWhere({ product: "MacBook Air", storage: "16GB / 512GB" }), "storage")).toEqual([
      "16GB",
      "512GB",
    ]);
    expect(col(skuWhere({ product: "MacBook Air", storage: "512GB" }), "storage")).toEqual(["512GB"]);
  });

  it("recovers chip/capacity/grade the model buried in `product`", () => {
    const where = skuWhere({ product: 'MacBook Air 15" M3 16GB/1TB Grade B' });
    expect(names(where)).toEqual(["MacBook", "Air", '15"']);
    expect(col(where, "chip")).toEqual(["M3"]);
    expect(col(where, "storage")).toEqual(["16GB", "1TB"]);
    expect(where.grade).toBe("B");
  });

  it("lets explicit arguments win over the parsed ones", () => {
    const where = skuWhere({ product: 'MacBook Air 13" M2', chip: "M3", grade: "a" });
    expect(col(where, "chip")).toEqual(["M3"]);
    expect(where.grade).toBe("A");
  });

  it("never asks the DB about an archived SKU", () => {
    expect(skuWhere({ product: "MacBook Air" }).archived).toBe(false);
  });

  it("drops capacity and grade when relaxed, keeping model and chip for alternatives", () => {
    const where = skuWhere({ product: 'MacBook Air 13"', chip: "M2", storage: "512GB", grade: "B" }, true);
    expect(names(where)).toEqual(["MacBook", "Air", '13"']);
    expect(col(where, "chip")).toEqual(["M2"]);
    expect(col(where, "storage")).toEqual([]);
    expect(where.grade).toBeUndefined();
  });
});
