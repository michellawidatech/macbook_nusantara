import { describe, expect, it } from "vitest";
import {
  differingPositions,
  isLikelyTypo,
  rankCandidates,
  serialDistance,
  suggestMatches,
} from "../src/lib/opnameMatch.js";

describe("serialDistance", () => {
  it("counts one slip for a wrong, missing, extra or swapped character", () => {
    expect(serialDistance("C02XC2F8JG5M", "C02XC2F8JG5N")).toBe(1);
    expect(serialDistance("C02XC2F8JG5M", "C02XC2F8JG5")).toBe(1);
    expect(serialDistance("C02XC2F8JG5M", "C02XC2F8JGG5M")).toBe(1);
    expect(serialDistance("C02XC2F8JG5M", "C02XC2F8GJ5M")).toBe(1);
  });

  it("reads O as 0 and I as 1, and ignores the barcode's S marker", () => {
    expect(serialDistance("C02XC2F8JG5M", "CO2XC2F8JG5M")).toBe(0);
    expect(serialDistance("FVFD60W8P3YV", "FVFD6OW8P3YV")).toBe(0);
    expect(serialDistance("SC02XC2F8JG5M", "C02XC2F8JG5M")).toBe(0);
    expect(serialDistance("C02XC2F8JG5M", "SC02XC2F8JG5M")).toBe(0);
    expect(serialDistance("", "AB")).toBe(2);
    expect(serialDistance("AB", "")).toBe(2);
  });
});

describe("isLikelyTypo", () => {
  it("allows two slips on a long serial and one on a short one, never zero", () => {
    expect(isLikelyTypo("C02XC2F8JG5M", "C02XC2F8JGXX")).toBe(true);
    expect(isLikelyTypo("C02XC2F8JG5M", "C02XC2F8JXXX")).toBe(false);
    expect(isLikelyTypo("AB12", "AB13")).toBe(true);
    expect(isLikelyTypo("AB12", "AB34")).toBe(false);
    expect(isLikelyTypo("AB12", "AB12")).toBe(false);
  });
});

describe("suggestMatches", () => {
  it("pairs each scan with its closest not-scanned unit, one unit per scan", () => {
    expect(
      suggestMatches(
        ["C02XC2F8JG5N", "C02XC2F8JGXX", "ZZZZZZZZZZZZ"],
        ["C02XC2F8JG5M", "FVFD60W8P3YV"],
      ),
    ).toEqual([
      { scanned: "C02XC2F8JG5N", expected: "C02XC2F8JG5M", distance: 1 },
    ]);
  });
});

describe("rankCandidates", () => {
  it("lists every not-scanned unit, closest first, ties in the order given", () => {
    expect(
      rankCandidates("C02XC2F8JG5N", [
        "ZZZZZZZZZZZZ",
        "AAAAAAAAAAAA",
        "C02XC2F8JG5M",
      ]).map((c) => c.serial),
    ).toEqual(["C02XC2F8JG5M", "ZZZZZZZZZZZZ", "AAAAAAAAAAAA"]);
  });
});

describe("differingPositions", () => {
  it("marks substituted characters, and nothing when the lengths differ", () => {
    expect(differingPositions("AB1C", "AB2C")).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(differingPositions("AB1C", "ABC")).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
