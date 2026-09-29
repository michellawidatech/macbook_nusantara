/**
 * What a serial barcode looks like, and what a serial is — the owner's rules of
 * 2026-09-21: Apple's barcode is `S` and then ten to twelve, the serial is the
 * ten to twelve, and nothing puts a supplier code on either.
 */
import { describe, expect, it } from "vitest";
import {
  BARE_PATTERN,
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  ORIGINAL_PATTERN,
  correctScanConfusables,
  inspectStoredSerial,
  isPrintableSerial,
  normaliseScan,
  readBarcode,
  readTypedSealed,
  suggestSupplierCode,
  validateSerial,
} from "../src/lib/serialScan.js";

/** A post-2010 serial: twelve. */
const SERIAL = "C02740137JKM";
/** Its barcode, as a scanner reads it. */
const BARCODE = `S${SERIAL}`;

describe("the shapes themselves", () => {
  it("a barcode is S and then ten to twelve", () => {
    expect(ORIGINAL_PATTERN.test(BARCODE)).toBe(true);
    expect(ORIGINAL_PATTERN.test("SDQXFPXWCK7")).toBe(true); // the owner's own
    expect(ORIGINAL_PATTERN.test(SERIAL)).toBe(false);
    expect(ORIGINAL_PATTERN.test("S123456789")).toBe(false); // S + nine
    expect(ORIGINAL_PATTERN.test("S1234567890123")).toBe(false); // S + thirteen
  });

  it("a serial is ten to twelve", () => {
    expect(BARE_PATTERN.test(SERIAL)).toBe(true);
    expect(BARE_PATTERN.test("DQXFPXWCK7")).toBe(true);
    expect(BARE_PATTERN.test("123456789")).toBe(false);
    expect(BARE_PATTERN.test("1234567890123")).toBe(false);
  });

  it("keeps the window where the owner set it", () => {
    expect([BASE_MIN_LENGTH, BASE_MAX_LENGTH]).toEqual([10, 12]);
  });
});

describe("reading a sealed unit's barcode", () => {
  it("takes the S off and hands back the serial", () => {
    const r = readBarcode(BARCODE);
    expect(r).toMatchObject({ ok: true, serial: SERIAL, corrected: false });
  });

  it("takes the owner's ten-character example", () => {
    const r = readBarcode("SDQXFPXWCK7");
    expect(r.ok && r.serial).toBe("DQXFPXWCK7");
  });

  it("refuses a read with no S — the wrong barcode on the box", () => {
    const r = readBarcode(SERIAL);
    expect(r).toMatchObject({ ok: false, reason: "no-marker" });
  });

  it("refuses a short read and a long one", () => {
    expect(readBarcode("S123456789")).toMatchObject({
      ok: false,
      reason: "length",
      length: 10,
    });
    expect(readBarcode(`S${SERIAL}${SERIAL}`)).toMatchObject({
      ok: false,
      reason: "length",
    });
  });

  it("reads an I as a 1 and an O as a 0, and says so", () => {
    const r = readBarcode("SC0274O137JKI");
    expect(r).toMatchObject({
      ok: true,
      serial: "C02740137JK1",
      corrected: true,
    });
  });

  it("upper-cases and trims before judging", () => {
    expect(readBarcode(`  ${BARCODE.toLowerCase()}\n`)).toMatchObject({
      ok: true,
      serial: SERIAL,
    });
  });

  it("refuses punctuation and nothing at all", () => {
    expect(readBarcode("SC02-40137JKM")).toMatchObject({ reason: "charset" });
    expect(readBarcode("   ")).toMatchObject({ reason: "empty" });
  });
});

describe("reading a sealed unit's typed serial", () => {
  it("takes ten to twelve as it is", () => {
    expect(readTypedSealed(SERIAL)).toMatchObject({ ok: true, serial: SERIAL });
    expect(readTypedSealed("dqxfpxwck7")).toMatchObject({
      ok: true,
      serial: "DQXFPXWCK7",
    });
  });

  it("reads I and O as 1 and 0 on the keyboard too (owner answer)", () => {
    expect(readTypedSealed("CO274O137JKM")).toMatchObject({
      ok: true,
      serial: "C02740137JKM",
      corrected: true,
    });
  });

  it("drops the S off a whole barcode typed from under the bars", () => {
    expect(readTypedSealed(BARCODE)).toMatchObject({
      ok: true,
      serial: SERIAL,
    });
  });

  it("keeps the S of a ten-character serial that begins with one", () => {
    // Without its first letter it is nine — no barcode — so it is a serial.
    expect(readTypedSealed("SQXFPXWCK7")).toMatchObject({
      ok: true,
      serial: "SQXFPXWCK7",
    });
  });

  it("refuses a length no serial has", () => {
    expect(readTypedSealed("123456789")).toMatchObject({
      ok: false,
      reason: "length",
    });
    expect(readTypedSealed("C02740137JKMXYZ")).toMatchObject({
      ok: false,
      reason: "length",
    });
  });
});

describe("validateSerial", () => {
  it("holds a sealed unit's stored serial to ten to twelve", () => {
    expect(validateSerial(SERIAL)).toBeNull();
    expect(validateSerial(BARCODE.padEnd(14, "X"))).toBe("length");
    expect(validateSerial("C02/40137JKM")).toBe("charset");
  });

  it("asks a second-hand one only that it is there", () => {
    expect(validateSerial("anything-at-all", { strict: false })).toBeNull();
    expect(validateSerial("  ", { strict: false })).toBe("empty");
  });
});

describe("inspectStoredSerial — the way out, onto a sticker", () => {
  it("passes a serial in either era's shape", () => {
    expect(inspectStoredSerial(SERIAL)).toBeNull();
    expect(inspectStoredSerial(BARCODE)).toBeNull();
  });

  it("has nothing to say about length — a second-hand serial is taken as read", () => {
    expect(inspectStoredSerial("C02")).toBeNull();
  });

  it("refuses to print an empty one", () => {
    expect(inspectStoredSerial("")).toEqual({ fault: "empty", level: "error" });
    expect(isPrintableSerial("")).toBe(false);
  });

  it("warns about an I, an O, or punctuation, and prints anyway", () => {
    expect(inspectStoredSerial("C0274O137JKM")).toEqual({
      fault: "confusable",
      level: "warning",
    });
    expect(inspectStoredSerial("C02-740137")).toEqual({
      fault: "charset",
      level: "warning",
    });
    expect(isPrintableSerial("C0274O137JKM")).toBe(true);
  });

  it("refuses characters no symbology can carry", () => {
    expect(inspectStoredSerial("C02740137JK€")).toEqual({
      fault: "unencodable",
      level: "error",
    });
  });
});

describe("the small helpers", () => {
  it("normalises a read the way every entry point does", () => {
    expect(normaliseScan("  sc02 7401 37jk \n")).toBe("SC02740137JK");
  });

  it("maps only the two letters Apple leaves out", () => {
    expect(correctScanConfusables("IOXO1")).toBe("10X01");
  });

  it("suggests a supplier code from a name, dropping the legal form", () => {
    expect(suggestSupplierCode("CV Apel Segar")).toBe("AS");
    expect(suggestSupplierCode("PT Mac Jaya")).toBe("MJ");
    expect(suggestSupplierCode("Batam")).toBe("BA");
  });
});
