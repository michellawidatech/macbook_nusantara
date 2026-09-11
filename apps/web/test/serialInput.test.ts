/**
 * One serial field, two kinds of hand.
 *
 * The owner's rule of 2026-09-08: a SCAN must carry the marker, a TYPED serial
 * has it added — and both apply to every serial box in the app, not only to
 * the one at Inbound & QC. See `lib/serialInput.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  readSerialInput,
  resolveSerialQuery,
} from "../src/lib/serialInput.js";

/** `CV Apel Segar`. The one code the seeded shop has issued. */
const CODES = ["AS"];
/** Apple's own barcode: S and then eleven. */
const SERIAL = "SC02740137JKM";
/** The same machine's store barcode — the origin code, then the whole serial. */
const STORE = `AS${SERIAL}`;
/** What is printed on the CASE: the serial with no marker. */
const BARE = SERIAL.slice(1);

describe("a scanned serial", () => {
  const scan = (raw: string) =>
    readSerialInput(raw, { scanned: true, supplierCodes: CODES });

  it("takes Apple's barcode", () => {
    const r = scan(SERIAL);
    expect(r.ok && r.serial).toBe(SERIAL);
    expect(r.ok && r.fromStoreBarcode).toBe(false);
  });

  it("takes the shop's own sticker and hands back the serial inside it", () => {
    const r = scan(STORE);
    expect(r.ok && r.serial).toBe(SERIAL);
    expect(r.ok && r.fromStoreBarcode).toBe(true);
  });

  it("REFUSES a burst with no marker, and never marks one", () => {
    /*
     * The asymmetry that is the whole point. A barcode carries its marker, so
     * a burst without one was aimed at the regulatory code or the part number
     * printed beside the serial's — which is exactly the misread the marker
     * exists to catch. Marking it would file a machine under a serial no scan
     * of it will ever match.
     */
    const r = scan(BARE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("no-marker");
    expect(!r.ok && r.source).toBe("scan");
  });

  it("refuses a read carrying an I or an O", () => {
    // Apple prints neither, so their presence is proof of a misread.
    expect(!scan("SC0274O137JKM").ok).toBe(true);
  });

  it("refuses two capitals the shop never issued", () => {
    // Membership, not shape: taking `ZZ` for an origin code would bite two
    // characters off the front of somebody else's barcode.
    const r = scan(`ZZ${SERIAL}`);
    expect(r.ok).toBe(false);
  });
});

describe("a typed serial", () => {
  const typed = (raw: string) =>
    readSerialInput(raw, { scanned: false, supplierCodes: CODES });

  it("puts the marker back on the number printed on the case", () => {
    // The owner's rule: the S is printed under the bars, not on the case, so
    // demanding it made the field refuse the number the machine shows.
    const r = typed(BARE);
    expect(r.ok && r.serial).toBe(SERIAL);
    expect(r.ok && r.marked).toBe(true);
  });

  it("leaves a serial that already carries its marker alone", () => {
    const r = typed(SERIAL);
    expect(r.ok && r.serial).toBe(SERIAL);
    expect(r.ok && r.marked).toBe(false);
  });

  it("never marks a serial twice", () => {
    // `SBJ347203KL` is both a legal marked serial and a legal bare one.
    // Marking it again would file the machine under `SSBJ347203KL`.
    const r = typed("SBJ347203KL");
    expect(r.ok && r.serial).toBe("SBJ347203KL");
  });

  it("takes the shop's own sticker, re-keyed", () => {
    // Somebody re-keying a graded machine reads whichever label faces them,
    // and on a graded one that is the shop's sticker.
    const r = typed(STORE);
    expect(r.ok && r.serial).toBe(SERIAL);
    expect(r.ok && r.fromStoreBarcode).toBe(true);
  });

  it("takes a lower-case, space-padded read", () => {
    expect(readSerialInput(`  ${BARE.toLowerCase()} `, { scanned: false }).ok)
      .toBe(true);
  });

  it("keeps the looser alphabet a person is allowed", () => {
    // The I/O rule is about a SCANNER misreading a 1 or a 0. A person looking
    // at the machine is the one witness who could legitimately key either.
    expect(typed("SC0274O137JKM").ok).toBe(true);
  });

  it("still refuses a shape no serial has", () => {
    // "Validation is absolute" (2026-09-01) — the keyboard is not exempt from
    // the length rule, only from the marker rule.
    expect(!typed("SC0274").ok).toBe(true);
    expect(!typed("C0274").ok).toBe(true);
    expect(!typed("SC02-740137JKM").ok).toBe(true);
    expect(!typed("").ok).toBe(true);
  });
});

describe("resolveSerialQuery", () => {
  const known = [SERIAL, "SDQXFPXWCK7"];

  it("hands back a serial the store already holds, untouched", () => {
    expect(resolveSerialQuery(SERIAL, known, CODES)).toBe(SERIAL);
  });

  it("finds a machine from its store barcode", () => {
    expect(resolveSerialQuery(STORE, known, CODES)).toBe(SERIAL);
  });

  it("finds a machine from the number printed on its case", () => {
    // The gap the owner reported: a search box that only stripped a store
    // prefix could never find `SC02740137JKM` from `C02740137JKM`, which is
    // what somebody reading the underside actually types.
    expect(resolveSerialQuery(BARE, known, CODES)).toBe(SERIAL);
  });

  it("finds a sticker whose supplier code the shop no longer lists", () => {
    // `readBarcode` will not vouch for two letters it does not recognise, and
    // that is right on the way IN. On the sales floor the question is only
    // whether this names a machine on a shelf.
    expect(resolveSerialQuery(`ZZ${SERIAL}`, known)).toBe(SERIAL);
  });

  it("hands an unknown query straight back, so the caller can say 'not found'", () => {
    expect(resolveSerialQuery("SC02999999QQ", known, CODES)).toBe(
      "SC02999999QQ",
    );
    expect(resolveSerialQuery("", known)).toBe("");
  });

  it("invents nothing when the store is empty", () => {
    expect(resolveSerialQuery(BARE, [])).toBe(BARE);
  });
});
