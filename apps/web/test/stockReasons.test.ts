/**
 * The fixed stock reasons and the courier split (owner ask 2026-10-30).
 */
import { describe, expect, it } from "vitest";
import {
  fixedReasonOf,
  isBatchReason,
  reasonsFor,
  splitEvenly,
} from "../src/lib/stockReasons.js";
import { batchProblems } from "../src/lib/adjustmentBatch.js";
import type { Unit } from "../src/mock/seed.js";

describe("reasons", () => {
  it("offers four per button, the return by direction", () => {
    expect(reasonsFor("OUT")).toEqual([
      "INTERNAL",
      "TRANSFER",
      "SERVICE",
      "SUPPLIER_RETURN",
    ]);
    expect(reasonsFor("IN")).toEqual([
      "INTERNAL",
      "TRANSFER",
      "SERVICE",
      "CUSTOMER_RETURN",
    ]);
  });

  it("writes only Internal use and Stock transfer itself", () => {
    expect(reasonsFor("OUT").filter(isBatchReason)).toEqual([
      "INTERNAL",
      "TRANSFER",
    ]);
  });

  it("reads a stored label back, whatever its case", () => {
    expect(fixedReasonOf("Stock Transfer")).toBe("TRANSFER");
    expect(fixedReasonOf("internal use")).toBe("INTERNAL");
    expect(fixedReasonOf("Pindah gudang")).toBeUndefined();
  });
});

describe("splitEvenly", () => {
  it("adds up to the fee, the rupiah left over going to the first unit", () => {
    expect(splitEvenly(100_001, 2)).toEqual([50_001, 50_000]);
    expect(splitEvenly(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
    expect(splitEvenly(90_000, 1)).toEqual([90_000]);
    expect(splitEvenly(5, 0)).toEqual([]);
  });
});

describe("batchProblems by reason", () => {
  const unit = (serial: string, status: string, locationId = "wh-1") =>
    ({ serial, status, locationId, skuId: "s" }) as unknown as Unit;
  const units = new Map<string, Unit>([
    ["SHELF", unit("SHELF", "TERSEDIA")],
    ["GONE", unit("GONE", "HILANG")],
    ["SOLD", unit("SOLD", "TERJUAL")],
  ]);
  const run = (
    kind: "IN" | "OUT",
    mode: "INTERNAL" | "TRANSFER",
    serial: string,
    locationId = "wh-2",
    skuId?: string,
  ) =>
    batchProblems(
      {
        kind,
        reason: mode === "TRANSFER" ? "Stock transfer" : "Internal use",
        lines: [{ serial, ...(skuId ? { skuId } : {}) }],
        locationId,
        mode,
      },
      (s) => units.get(s),
      (s) => s,
    );

  it("transfers a unit on a shelf from either button", () => {
    expect(run("IN", "TRANSFER", "SHELF")).toEqual([]);
    expect(run("OUT", "TRANSFER", "SHELF")).toEqual([]);
    expect(run("OUT", "TRANSFER", "SHELF", "wh-1")[0]).toMatch(/already in/);
  });

  it("refuses to transfer a written-off or sold unit", () => {
    expect(run("IN", "TRANSFER", "GONE")[0]).toMatch(/Internal use/);
    expect(run("OUT", "TRANSFER", "SOLD")[0]).toMatch(/sold/);
  });

  it("brings back only a written-off unit under Internal use", () => {
    expect(run("IN", "INTERNAL", "GONE")).toEqual([]);
    expect(run("IN", "INTERNAL", "SHELF")[0]).toMatch(/Stock transfer/);
  });

  it("creates an unknown serial on a transfer, never on a write-off", () => {
    expect(run("OUT", "TRANSFER", "NEWONE", "wh-2", "sku-1")).toEqual([]);
    expect(run("OUT", "INTERNAL", "NEWONE")[0]).toMatch(/not in the system/);
  });
});
