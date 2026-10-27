/**
 * Matching a month of the bank's e-statement against the POS (owner ask
 * 2026-10-27, answer 3B) — one test per rule in `lib/bankMatch.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  guessCategory,
  isTypo,
  matchStatement,
  type BankLine,
  type PosMovement,
} from "../src/lib/bankMatch.js";

const line = (
  id: string,
  date: string,
  amount: number,
  description = "TRSF E-BANKING CR",
): BankLine => ({ id, date, amount, description });
const move = (key: string, date: string, amount: number): PosMovement => ({
  key,
  date,
  amount,
});

describe("isTypo", () => {
  it("is one digit different, or two neighbours swapped", () => {
    expect(isTypo(1_500_000, 1_600_000)).toBe(true);
    expect(isTypo(1_250_000, 1_520_000)).toBe(true);
    expect(isTypo(-850_000, -580_000)).toBe(true);
  });
  it("is not a different length, two digits apart, or the same figure", () => {
    expect(isTypo(150_000, 1_500_000)).toBe(false);
    expect(isTypo(1_500_000, 1_600_001)).toBe(false);
    expect(isTypo(1_250_000, 1_052_000)).toBe(false);
    expect(isTypo(700_000, 700_000)).toBe(false);
  });
});

describe("guessCategory", () => {
  it("reads the bank's own words", () => {
    expect(guessCategory("BUNGA", 4_512)).toEqual({
      direction: "INCOME",
      reason: "BUNGA",
    });
    expect(guessCategory("PAJAK BUNGA", -902)).toEqual({
      direction: "EXPENSE",
      reason: "BUNGA",
    });
    expect(guessCategory("BIAYA ADM", -10_000)).toEqual({
      direction: "EXPENSE",
      reason: "BUNGA",
    });
    expect(guessCategory("TRSF E-BANKING DB GAJI OKTOBER", -4_000_000)).toEqual(
      { direction: "EXPENSE", reason: "PAYROLL" },
    );
    expect(guessCategory("SETORAN VIA CDM 0123", 5_000_000)).toEqual({
      direction: "MOVE",
      reason: "CASH_TO_BANK",
    });
    expect(guessCategory("TARIK TUNAI ATM", -1_000_000)).toEqual({
      direction: "MOVE",
      reason: "BANK_TO_CASH",
    });
  });
  it("leaves anything else unset", () => {
    expect(guessCategory("TRSF E-BANKING CR BUDI", 750_000)).toBeUndefined();
  });
});

describe("matchStatement", () => {
  it("matches the same amount on the same day, then within three days", () => {
    const r = matchStatement(
      [
        line("l1", "2026-09-01", 18_450_000),
        line("l2", "2026-09-03", -812_345),
      ],
      [
        move("p:a", "2026-08-31", 18_450_000),
        move("e:b", "2026-09-03", -812_345),
      ],
    );
    expect(r.matched).toEqual([
      { reason: "EXACT", lineIds: ["l2"], movementKeys: ["e:b"] },
      { reason: "DATE_SHIFT", lineIds: ["l1"], movementKeys: ["p:a"] },
    ]);
    expect(r.suggestions).toEqual([]);
    expect(r.bankOnly).toEqual([]);
    expect(r.posOnly).toEqual([]);
  });

  it("does not shift further than three days, nor across a sign", () => {
    const r = matchStatement(
      [line("l1", "2026-09-10", 500_000), line("l2", "2026-09-10", -500_000)],
      [move("p:a", "2026-09-05", 500_000)],
    );
    expect(r.matched).toEqual([]);
    expect(r.posOnly).toEqual(["p:a"]);
  });

  it("uses each movement once, nearest first", () => {
    const r = matchStatement(
      [line("l1", "2026-09-02", 100_000), line("l2", "2026-09-02", 100_000)],
      [
        move("p:far", "2026-09-04", 100_000),
        move("p:near", "2026-09-02", 100_000),
      ],
    );
    expect(r.matched.map((m) => m.movementKeys[0])).toEqual([
      "p:near",
      "p:far",
    ]);
  });

  it("suggests a split: one bank line is several POS movements", () => {
    const r = matchStatement(
      [line("l1", "2026-09-12", 8_850_000, "SHOPEE PAYOUT")],
      [
        move("p:1", "2026-09-11", 3_000_000),
        move("p:2", "2026-09-12", 2_350_000),
        move("p:3", "2026-09-12", 3_500_000),
        move("p:x", "2026-09-12", 990_000),
      ],
    );
    expect(r.suggestions).toEqual([
      {
        reason: "SPLIT",
        lineIds: ["l1"],
        movementKeys: ["p:3", "p:1", "p:2"],
      },
    ]);
    expect(r.posOnly).toEqual(["p:x"]);
  });

  it("suggests a merge: several CDM slips are one deposit", () => {
    const r = matchStatement(
      [
        line("l1", "2026-09-15", 5_000_000, "SETORAN VIA CDM"),
        line("l2", "2026-09-15", 3_000_000, "SETORAN VIA CDM"),
        line("l3", "2026-09-15", 2_000_000, "SETORAN VIA CDM"),
      ],
      [move("i:cdm", "2026-09-15", 10_000_000)],
    );
    expect(r.suggestions).toEqual([
      { reason: "MERGE", lineIds: ["l1", "l2", "l3"], movementKeys: ["i:cdm"] },
    ]);
  });

  it("suggests a typo, with the bank's figure to correct to", () => {
    const r = matchStatement(
      [line("l1", "2026-09-20", 1_520_000)],
      [move("p:t", "2026-09-21", 1_250_000)],
    );
    expect(r.suggestions).toEqual([
      {
        reason: "TYPO",
        lineIds: ["l1"],
        movementKeys: ["p:t"],
        correctTo: 1_520_000,
      },
    ]);
  });

  it("suggests a deduction when the bank got up to 5% less", () => {
    const r = matchStatement(
      [line("l1", "2026-09-22", 9_700_000), line("l2", "2026-09-22", 900_000)],
      [
        move("p:big", "2026-09-20", 10_000_000),
        move("p:small", "2026-09-22", 1_000_000),
      ],
    );
    expect(r.suggestions).toEqual([
      {
        reason: "DEDUCTION",
        lineIds: ["l1"],
        movementKeys: ["p:big"],
        fee: 300_000,
      },
    ]);
    // 10% short is not a fee: both stay unexplained.
    expect(r.bankOnly).toEqual([{ lineId: "l2" }]);
    expect(r.posOnly).toEqual(["p:small"]);
  });

  it("lists bank-only lines with a guess, and POS-only movements", () => {
    const r = matchStatement(
      [line("l1", "2026-09-30", 4_512, "BUNGA")],
      [move("e:lost", "2026-09-29", -75_000)],
    );
    expect(r.bankOnly).toEqual([
      { lineId: "l1", guess: { direction: "INCOME", reason: "BUNGA" } },
    ]);
    expect(r.posOnly).toEqual(["e:lost"]);
  });

  it("gives the same answer for the same input", () => {
    const lines = [
      line("l1", "2026-09-12", 8_850_000),
      line("l2", "2026-09-13", 1_000),
    ];
    const moves = [
      move("p:1", "2026-09-12", 3_000_000),
      move("p:2", "2026-09-12", 5_850_000),
    ];
    expect(matchStatement(lines, moves)).toEqual(matchStatement(lines, moves));
  });
});
