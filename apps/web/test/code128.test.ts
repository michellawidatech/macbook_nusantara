/**
 * Code 128 — `lib/code128.ts`.
 *
 * A wrong barcode is not a visible bug: it prints, it looks exactly like a
 * barcode, and it is discovered by a scanner that reads a different serial or
 * none at all — after a roll of thermal stock has gone through the printer.
 * So this checks the encoding against the symbology's own invariants and
 * against a worked checksum, rather than against a snapshot of what the
 * function currently does.
 */
import { describe, expect, it } from "vitest";
import {
  code128Bars,
  code128Pattern,
  code128Values,
  code128Width,
  isEncodable,
} from "../src/lib/code128.js";

describe("code128Values", () => {
  it("brackets the data with Start B and Stop", () => {
    const v = code128Values("A");
    expect(v[0]).toBe(104);
    expect(v[v.length - 1]).toBe(106);
  });

  it("encodes subset B as code point minus 32", () => {
    // "A" is 65, so its symbol value is 33.
    expect(code128Values("A")[1]).toBe(33);
    expect(code128Values("0")[1]).toBe(16);
  });

  it("computes the modulo-103 weighted checksum", () => {
    // Start B (104) + 33 × 1 = 137; 137 mod 103 = 34.
    const v = code128Values("A");
    expect(v[v.length - 2]).toBe(34);
  });

  it("weights each symbol by its position, not just its value", () => {
    // The whole point of the checksum: two strings with the same characters
    // in a different order must not check the same.
    const a = code128Values("AB");
    const b = code128Values("BA");
    expect(a[a.length - 2]).not.toBe(b[b.length - 2]);
  });

  it("checks a real shop serial", () => {
    // ASBJ347203KLM — the owner's worked example, prefixed for Apel Segar.
    // Symbol values 33 51 34 42 19 20 23 18 16 19 43 44 45, weighted 1…13 and
    // added to the start code, come to 2949; 2949 mod 103 = 65.
    const v = code128Values("ASBJ347203KLM");
    expect(v[v.length - 2]).toBe(65);
  });
});

describe("code128Pattern", () => {
  it("gives every symbol eleven modules, and the stop thirteen", () => {
    const text = "ASBJ347203KLM";
    const symbols = code128Values(text).length;
    // 11 per symbol, plus the stop's two extra bars.
    expect(code128Width(text)).toBe(symbols * 11 + 2);
  });

  it("starts and ends on a bar", () => {
    // A pattern is read starting with a bar; ending on one is what the stop
    // symbol's thirteenth module is for. An even-length run list would mean
    // the barcode finished on white, which no scanner will terminate on.
    const runs = code128Pattern("ASBJ347203KLM");
    expect(runs.length % 2).toBe(1);
  });

  it("never emits a run wider than four modules", () => {
    // Code 128's alphabet is built from runs of 1–4. A 5 would mean a
    // mis-transcribed row of the table, which is the failure mode this file
    // mostly exists to catch.
    for (const run of code128Pattern("ASBJ347203KLM 0123")) {
      expect(run).toBeGreaterThanOrEqual(1);
      expect(run).toBeLessThanOrEqual(4);
    }
  });

  it("refuses what subset B cannot carry, rather than encoding it wrong", () => {
    expect(isEncodable("ASBJ347203KLM")).toBe(true);
    expect(isEncodable("SÉRIAL")).toBe(false);
    expect(isEncodable("")).toBe(false);
    expect(code128Pattern("SÉRIAL")).toEqual([]);
  });
});

describe("code128Bars", () => {
  it("returns the odd runs — the bars — and their offsets", () => {
    const runs = code128Pattern("A");
    const bars = code128Bars("A");
    // Half the runs, rounded up: the list starts and ends on a bar.
    expect(bars.length).toBe(Math.ceil(runs.length / 2));
    expect(bars[0]).toEqual({ x: 0, width: runs[0] });
    // The second bar starts after the first bar and the first space.
    expect(bars[1]!.x).toBe(runs[0]! + runs[1]!);
  });

  it("ends exactly at the pattern's width", () => {
    const bars = code128Bars("ASBJ347203KLM");
    const last = bars[bars.length - 1]!;
    expect(last.x + last.width).toBe(code128Width("ASBJ347203KLM"));
  });
});
