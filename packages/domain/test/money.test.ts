import { describe, expect, it } from "vitest";
import { formatNumber, formatRupiah, parseRupiah } from "../src/money.js";

const NBSP = "\u00A0";

/** Unwrap a parse that is expected to succeed. */
function value(input: string): bigint {
  const r = parseRupiah(input);
  if (!r.ok) throw new Error(`expected "${input}" to parse, got ${r.reason}`);
  return r.value;
}

/** The reason a parse is expected to fail with. */
function reason(input: string): string {
  const r = parseRupiah(input);
  if (r.ok)
    throw new Error(`expected "${input}" to be rejected, got ${r.value}`);
  return r.reason;
}

describe("02 §9 — money inputs accept what people type", () => {
  it("accepts the four forms the plan names", () => {
    expect(value("4200000")).toBe(4_200_000n);
    expect(value("4.200.000")).toBe(4_200_000n);
    expect(value("4,2jt")).toBe(4_200_000n);
    expect(value("4200rb")).toBe(4_200_000n);
  });

  it("accepts the long suffixes and any spacing or casing", () => {
    expect(value("4,2 juta")).toBe(4_200_000n);
    expect(value("4200 RIBU")).toBe(4_200_000n);
    expect(value("Rp 4.200.000")).toBe(4_200_000n);
    expect(value(`Rp${NBSP}4.200.000`)).toBe(4_200_000n);
    expect(value("rp4200000")).toBe(4_200_000n);
  });

  it("handles zero, negatives and decimals that stay whole", () => {
    expect(value("0")).toBe(0n);
    expect(value("-50000")).toBe(-50_000n);
    expect(value("-4,2jt")).toBe(-4_200_000n);
    expect(value("1,5rb")).toBe(1_500n);
    expect(value("4.200.000,00")).toBe(4_200_000n);
    expect(value("0,5jt")).toBe(500_000n);
  });

  it("rejects an empty input", () => {
    expect(reason("")).toBe("KOSONG");
    expect(reason("   ")).toBe("KOSONG");
    expect(reason("Rp")).toBe("KOSONG");
  });

  it("rejects nonsense rather than guessing at it", () => {
    expect(reason("abc")).toBe("FORMAT");
    expect(reason("4.2")).toBe("FORMAT"); // 4.2 or 4 200? never guess money
    expect(reason("1.2345")).toBe("FORMAT");
    expect(reason("12.34.567")).toBe("FORMAT");
    expect(reason("jt")).toBe("FORMAT");
    expect(reason("-")).toBe("FORMAT");
    expect(reason("4,2,3")).toBe("FORMAT");
  });

  it("rejects amounts that are not a whole rupiah", () => {
    expect(reason("4,5")).toBe("PECAHAN");
    expect(reason("1,0005rb")).toBe("PECAHAN");
  });
});

describe("02 §9 — money display", () => {
  it("groups thousands with dots", () => {
    expect(formatNumber(0n)).toBe("0");
    expect(formatNumber(1n)).toBe("1");
    expect(formatNumber(999n)).toBe("999");
    expect(formatNumber(1_000n)).toBe("1.000");
    expect(formatNumber(4_200_000n)).toBe("4.200.000");
    expect(formatNumber(-4_200_000n)).toBe("-4.200.000");
  });

  it("writes Rp with a non-breaking space and no decimals", () => {
    expect(formatRupiah(4_200_000n)).toBe(`Rp${NBSP}4.200.000`);
    expect(formatRupiah(0n)).toBe(`Rp${NBSP}0`);
    expect(formatRupiah(-4_200_000n)).toBe(`-Rp${NBSP}4.200.000`);
    // The space must not be a plain one, or a receipt wraps mid-amount.
    expect(formatRupiah(1_000n)).not.toContain("Rp 1.000");
  });

  it("round-trips what it formats", () => {
    for (const n of [
      0n,
      1n,
      999n,
      1_000n,
      4_200_000n,
      -4_200_000n,
      123_456_789n,
    ]) {
      expect(value(formatRupiah(n))).toBe(n);
    }
  });
});
