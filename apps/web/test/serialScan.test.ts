/**
 * The two barcodes a machine carries, as the owner restated them on
 * 2026-09-01.
 *
 * ```
 *   original   S  + 10–12          11–13 characters
 *   store      II + S + 10–12      13–15 characters
 * ```
 *
 * The whole file is a spec for `lib/serialScan.ts`, and the thing worth
 * holding honest is that **`Unit.serial` is Apple's barcode**: nothing is
 * prefixed at intake, the store form is derived for the sticker, and a read of
 * either barcode comes back as the same serial.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  inspectStoredSerial,
  isOriginalBarcode,
  isPrintableSerial,
  isStoreBarcode,
  isValidSerial,
  normaliseScan,
  readBarcode,
  resolveScannedSerial,
  storeBarcodeOf,
  suggestSupplierCode,
  markTypedSerial,
  OLDER_MODEL_PATTERN,
  validateSerial,
  ORIGINAL_PATTERN,
  STORE_PATTERN,
} from "../src/lib/serialScan.js";

/** Apel Segar and Makmur Jaya — the two codes the seed issues. */
const CODES = ["AS", "MJ"];
const OPTS = { supplierCodes: CODES } as const;

/** The owner's own example, in both forms. */
const ORIGINAL = "SBJ347203KLM";
// `AS` + the WHOLE original, S included — which is the correction. Written
// out rather than interpolated so the string a reader sees is the string.
const STORE = "ASSBJ347203KLM";

describe("the shapes themselves", () => {
  it("an original barcode is S and then ten to twelve", () => {
    expect(isOriginalBarcode(ORIGINAL)).toBe(true);
    expect(isOriginalBarcode("SDQXFPXWCK7")).toBe(true); // S + 10
    expect(isOriginalBarcode("SBJ347203KLMN")).toBe(true); // S + 12
  });

  it("refuses one that is short, long, or unmarked", () => {
    expect(isOriginalBarcode("SBJ347203")).toBe(false); // S + 9
    expect(isOriginalBarcode("SBJ347203KLMNO")).toBe(false); // S + 13
    expect(isOriginalBarcode("BJ347203KLM")).toBe(false); // no marker
  });

  it("a store barcode is two issued letters, then a whole original", () => {
    // The S is KEPT — that is the correction. `ASBJ…` is `AS` + `SBJ…`.
    expect(isStoreBarcode(STORE, CODES)).toBe(true);
    expect(STORE).toBe(`AS${ORIGINAL}`);
  });

  it("is not a store barcode when nobody issued those two letters", () => {
    // Membership, not shape. `XX` looks exactly like an origin code and is
    // not one, so taking it for one would bite two characters off a barcode
    // this shop has never printed.
    expect(isStoreBarcode("XXSBJ347203KLM", CODES)).toBe(false);
  });

  it("is not a store barcode without the S behind the code", () => {
    // The old scheme stripped it. Keeping it is what makes the two windows
    // impossible to confuse.
    expect(isStoreBarcode("ASBJ347203KLMN", ["AS"])).toBe(false);
  });

  it("the two patterns can never both match one string", () => {
    // The property the whole design rests on: a store barcode is exactly two
    // characters longer than the original inside it, so no read is both.
    for (const s of [
      ORIGINAL,
      STORE,
      "SDQXFPXWCK7",
      "ASSDQXFPXWCK7",
      "SBJ347203KLMN",
      "MJSBJ347203KLMN",
    ]) {
      expect(ORIGINAL_PATTERN.test(s) && STORE_PATTERN.test(s)).toBe(false);
    }
  });
});

describe("reading a barcode", () => {
  it("reads Apple's own and stores it unchanged", () => {
    // Nothing is prefixed. This is the correction of 2026-09-01 in one line.
    expect(readBarcode(ORIGINAL, OPTS)).toEqual({
      ok: true,
      scanned: ORIGINAL,
      kind: "ORIGINAL",
      serial: ORIGINAL,
      supplierCode: "",
    });
  });

  it("reads the shop's sticker back to the same serial", () => {
    expect(readBarcode(STORE, OPTS)).toEqual({
      ok: true,
      scanned: STORE,
      kind: "STORE",
      serial: ORIGINAL,
      supplierCode: "AS",
    });
  });

  it("needs no supplier to file a serial, which is the point", () => {
    // The old reader took the PO's supplier and prefixed with it, so a
    // supplier with no code could not take stock in at all.
    expect(readBarcode(ORIGINAL).ok).toBe(true);
  });

  it("refuses anything that does not begin with S", () => {
    // The owner's rule, absolute: *"if not begin with S don't accept"*. Twelve
    // perfectly well-formed characters, and still refused — because that is
    // what the regulatory barcode beside the serial looks like.
    expect(readBarcode("BJ347203KLMN", OPTS)).toMatchObject({
      ok: false,
      reason: "no-marker",
    });
  });

  it("refuses two capitals nobody issued in front of a serial", () => {
    expect(readBarcode("XXSBJ347203KLM", OPTS)).toMatchObject({
      ok: false,
      reason: "no-marker",
    });
  });

  it("refuses a short read and a long one, and says which", () => {
    expect(readBarcode("SBJ347203", OPTS)).toMatchObject({
      ok: false,
      reason: "length",
      length: 9,
    });
    // Two scans into one field with no Enter between them.
    expect(readBarcode(`${ORIGINAL}${ORIGINAL}`, OPTS)).toMatchObject({
      ok: false,
      reason: "length",
    });
  });

  it("refuses an I or an O, which Apple never prints", () => {
    expect(readBarcode("SBJ34I203KLM", OPTS)).toMatchObject({
      ok: false,
      reason: "confusable",
    });
    expect(readBarcode("SBJ34O203KLM", OPTS)).toMatchObject({
      ok: false,
      reason: "confusable",
    });
    // The digits they are misread as are fine.
    expect(readBarcode("SBJ341203KLM", OPTS).ok).toBe(true);
    expect(readBarcode("SBJ340203KLM", OPTS).ok).toBe(true);
  });

  it("judges the store form by the serial inside it", () => {
    // Anything true of an original barcode has to be true of the one wrapped
    // in a store barcode, or the same machine would pass one way and fail the
    // other.
    expect(readBarcode("ASSBJ34I203KLM", OPTS)).toMatchObject({
      ok: false,
      reason: "confusable",
    });
  });

  it("upper-cases and trims before judging, because a scan is not a typist", () => {
    expect(readBarcode(`  ${ORIGINAL.toLowerCase()}  `, OPTS)).toMatchObject({
      ok: true,
      serial: ORIGINAL,
    });
  });

  it("refuses punctuation inside a right-length read", () => {
    expect(readBarcode("SBJ-347203KL", OPTS)).toMatchObject({
      ok: false,
      reason: "charset",
    });
  });

  it("says nothing arrived rather than guessing", () => {
    expect(readBarcode("   ", OPTS)).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("reads a store barcode whose own code begins with S", () => {
    // The case the old scheme could not settle. `SB` + `SDQXFPXWCK7` has an S
    // at index 0 AND at index 2, and only one reading survives: the store form
    // is tested first and demands an issued code with an S behind it, which
    // `S` alone cannot satisfy.
    expect(readBarcode("SBSDQXFPXWCK7", { supplierCodes: ["SB"] })).toEqual({
      ok: true,
      scanned: "SBSDQXFPXWCK7",
      kind: "STORE",
      serial: "SDQXFPXWCK7",
      supplierCode: "SB",
    });
  });
});

describe("storeBarcodeOf", () => {
  it("puts the origin code in front of the whole serial", () => {
    expect(storeBarcodeOf(ORIGINAL, "AS")).toBe(STORE);
  });

  it("refuses to build one without a supplier code", () => {
    // A half-formed sticker is worse than none: it prints, it scans, and it
    // scans as nothing.
    expect(storeBarcodeOf(ORIGINAL, undefined)).toBeNull();
    expect(storeBarcodeOf(ORIGINAL, "A")).toBeNull();
  });

  it("refuses to build one from a serial that is not an original barcode", () => {
    expect(storeBarcodeOf("BJ347203KLM", "AS")).toBeNull();
  });

  it("round-trips: the sticker reads back to the serial it was made from", () => {
    const sticker = storeBarcodeOf(ORIGINAL, "AS")!;
    expect(readBarcode(sticker, OPTS)).toMatchObject({ serial: ORIGINAL });
  });
});

describe("markTypedSerial — the marker somebody had no reason to type", () => {
  it("puts the S back on a bare serial read off the case", () => {
    // The owner's *"if the barcode is typed and is 10–12 digit, auto-add S"*.
    // The marker is printed under the bars, not on the case, so the number a
    // person is copying does not have one — and the field used to refuse it.
    expect(markTypedSerial("BJ347203KLM")).toBe("SBJ347203KLM");
    expect(isValidSerial(markTypedSerial("BJ347203KLM"))).toBe(true);
  });

  it("takes an older model's eleven characters as well as a modern twelve", () => {
    // `OLDER_MODEL_PATTERN` is the shape this exists for: pre-2010 Macs carry
    // eleven characters, everything since carries twelve.
    const older = "C02DQXFPXWC";
    expect(OLDER_MODEL_PATTERN.test(older)).toBe(true);
    expect(older).toHaveLength(11);
    expect(markTypedSerial(older)).toBe(`S${older}`);
    expect(markTypedSerial("C02DQXFPXWCK")).toBe("SC02DQXFPXWCK");
  });

  it("upper-cases what was typed in lower case", () => {
    expect(markTypedSerial("bj347203klm")).toBe("SBJ347203KLM");
  });

  it("never marks a serial that is already one", () => {
    // The trap this closes. `SBJ347203KL` is eleven characters, so it is both
    // a legal marked serial (S + ten) and a legal bare one — and marking it
    // twice would file the machine under SSBJ347203KL, which no scan of it
    // will ever match.
    expect(markTypedSerial("SBJ347203KL")).toBe("SBJ347203KL");
    expect(markTypedSerial(ORIGINAL)).toBe(ORIGINAL);
  });

  it("leaves anything it cannot rescue for validateSerial to refuse", () => {
    // Too short to be either form, and a marked serial three characters
    // short. Both come back untouched and are refused by name.
    expect(markTypedSerial("BJ34720")).toBe("BJ34720");
    expect(validateSerial(markTypedSerial("BJ34720"))).toBe("no-marker");
    expect(markTypedSerial("SBJ347203")).toBe("SBJ347203");
    expect(validateSerial(markTypedSerial("SBJ347203"))).toBe("length");
  });

  it("does not rescue a scan — that is the whole point of the marker", () => {
    // Not a property of this function but of its one caller: a scan is passed
    // through untouched, because a barcode that arrived without an S was
    // aimed at the regulatory code beside the serial's. `readBarcode` is what
    // a scan goes through, and it refuses the same string this would mark.
    expect(readBarcode("BJ347203KLM", OPTS)).toMatchObject({
      ok: false,
      reason: "no-marker",
    });
  });
});

describe("validateSerial — the typed route", () => {
  it("holds a typed serial to the same shape as a scanned one", () => {
    // The owner's *"if any barcode is not adhering to this rule then do not
    // accept"*. The old rules let a hand-keyed serial through on length alone.
    expect(isValidSerial(ORIGINAL)).toBe(true);
    expect(validateSerial("BJ347203KLM")).toBe("no-marker");
    expect(validateSerial("SBJ347203")).toBe("length");
    expect(validateSerial("SBJ-347203KL")).toBe("charset");
    expect(validateSerial("")).toBe("empty");
  });

  it("lets an I or an O through, unlike a scan", () => {
    // Deliberate. That rule catches a SCANNER misreading a 1 or a 0, and the
    // person typing is the one witness who can see the machine. It becomes a
    // warning at print time instead.
    expect(isValidSerial("SBJ34I203KLM")).toBe(true);
    expect(inspectStoredSerial("SBJ34I203KLM")).toMatchObject({
      fault: "confusable",
      level: "warning",
    });
  });
});

describe("resolveScannedSerial — the sales floor", () => {
  const KNOWN = [ORIGINAL, "SDQXFPXWCK7"];

  it("returns a stored serial untouched", () => {
    expect(resolveScannedSerial(ORIGINAL, KNOWN, CODES)).toBe(ORIGINAL);
  });

  it("finds the unit from the shop's own sticker", () => {
    // The whole reason this function exists: the counter reads whichever
    // barcode faces them.
    expect(resolveScannedSerial(STORE, KNOWN, CODES)).toBe(ORIGINAL);
  });

  it("still finds it under a code the shop has since retired", () => {
    // `readBarcode` will not strip two letters it cannot vouch for, and that
    // is right on the way IN. Out here a serial that EXISTS is proof enough,
    // or machines labelled by a supplier who has left become unscannable.
    expect(resolveScannedSerial(STORE, KNOWN, [])).toBe(ORIGINAL);
  });

  it("hands back anything it cannot place, so the caller says unknown", () => {
    expect(resolveScannedSerial("SZZ999999ZZZ", KNOWN, CODES)).toBe(
      "SZZ999999ZZZ",
    );
    expect(resolveScannedSerial("not a serial", KNOWN, CODES)).toBe(
      "NOT A SERIAL",
    );
  });

  it("says nothing about nothing", () => {
    expect(resolveScannedSerial("", KNOWN, CODES)).toBe("");
  });
});

describe("inspectStoredSerial — the way out, onto a sticker", () => {
  it("passes a serial in the current shape", () => {
    expect(inspectStoredSerial(ORIGINAL)).toBeNull();
  });

  it("refuses to print an empty one, and only that", () => {
    expect(inspectStoredSerial("")).toMatchObject({ level: "error" });
    expect(isPrintableSerial("")).toBe(false);
  });

  it("warns about a serial that predates the rules but still prints it", () => {
    // Everything taken in before the correction. The shop may well still have
    // the machine, and refusing would leave it with no label at all.
    expect(inspectStoredSerial("C02AA111AAAX")).toMatchObject({
      fault: "shape",
      level: "warning",
    });
    expect(isPrintableSerial("C02AA111AAAX")).toBe(true);
  });

  it("refuses characters no symbology can carry", () => {
    expect(inspectStoredSerial("SBJ3472 03KL")).toMatchObject({
      fault: "unencodable",
      level: "error",
    });
  });
});

describe("the small helpers", () => {
  it("normalises a scan the way every entry point does", () => {
    expect(normaliseScan("  sbj347203klm ")).toBe(ORIGINAL);
  });

  it("suggests a supplier code from a name, dropping the legal form", () => {
    expect(suggestSupplierCode("CV Apel Segar")).toBe("AS");
    expect(suggestSupplierCode("PT Makmur Jaya")).toBe("MJ");
    expect(suggestSupplierCode("Sinar")).toBe("SI");
    expect(suggestSupplierCode("PT")).toBe("");
  });

  it("keeps the base window where the owner set it", () => {
    // Guards the two numbers every rule in the file is written against.
    expect([BASE_MIN_LENGTH, BASE_MAX_LENGTH]).toEqual([10, 12]);
  });
});
