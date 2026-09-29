/**
 * What a serial barcode looks like, and what a serial is.
 *
 * ## The rules, restated by the owner on 2026-09-21
 *
 * This REPLACES the 2026-09-01 model, in which `Unit.serial` held Apple's
 * barcode with its `S` and the shop's sticker was a DERIVED "store barcode" —
 * the supplier's two-letter code in front of it. The owner's words, the same
 * day: *"Delete the supplier auto-append in serial number. It turns out we do
 * not record that at all."* So there is ONE barcode now, Apple's, and the
 * serial is the number inside it:
 *
 * ```
 *   S C 0 2 7 4 0 1 3 7 J K       Apple's barcode, as a scanner reads it
 *   ^                             the marker, printed under the bars and NOT
 *                                 on the case — never part of the serial
 *     C 0 2 7 4 0 1 3 7 J K       the serial: 10–12, what a NEW unit stores
 * ```
 *
 * | | barcode (a scan) | serial (typed, and stored) |
 * |---|---|---|
 * | shape | `S` + 10–12 | 10–12 |
 * | length | 11–13 | 10–12 |
 *
 * Which rules a serial is held to is decided by the unit's CONDITION, in
 * `lib/serialInput.ts`: a sealed (`NEW`) unit is held to the shapes above and
 * its `I`/`O` are read as `1`/`0`; a second-hand one is taken exactly as read.
 * This file owns the shapes and the pieces; that one owns the decision.
 *
 * ## Why the `S` goes
 *
 * It is a marker, not a character of the serial — it says "this barcode is
 * the serial" to a scanner aimed at the underside of a box that also carries a
 * regulatory code and a part number of much the same shape. A person copying
 * the number off the case never sees it. Keeping it (the 2026-09-01 model)
 * made the database hold a string nobody reads off the machine, and made every
 * search box add one back.
 *
 * ## Units taken in before this
 *
 * Every serial minted between 2026-09-01 and 2026-09-21 — and the demo seed —
 * carries the `S`. Nothing rewrites them: `resolveSerialQuery` tries the
 * marked and the unmarked reading of whatever is scanned or typed, so both
 * kinds are found the same way, and a sticker prints the serial as stored.
 *
 * Pure: no React, no store, no DOM. `test/serialScan.test.ts` is the spec.
 */

/**
 * The supplier's two-letter origin code (Settings → Suppliers).
 *
 * ⚠️ Nothing prints or files it any more (owner, 2026-09-21: "we do not
 * record that at all"). The field is still on the supplier and still edited
 * there; retiring it is a separate decision.
 */
export const SUPPLIER_CODE_LENGTH = 2;

/** A supplier code is exactly two capitals. */
export const SUPPLIER_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Apple's serial, and the only length rule in the file.
 *
 * Ten at the short end is the owner's number, and the example that forced it is
 * `SDQXFPXWCK7` — the barcode of `DQXFPXWCK7`, a ten-character serial. Twelve
 * at the long end is Apple's 2010–2020 length.
 */
export const BASE_MIN_LENGTH = 10;
export const BASE_MAX_LENGTH = 12;

/** The marker on the front of Apple's serial barcode. */
export const SCAN_PREFIX = "S";

/** Apple's serial barcode: `S` and then ten to twelve. */
export const ORIGINAL_PATTERN = new RegExp(
  `^${SCAN_PREFIX}[A-Z0-9]{${BASE_MIN_LENGTH},${BASE_MAX_LENGTH}}$`,
);

/** A serial as a sealed unit stores it: ten to twelve capitals and digits. */
export const BARE_PATTERN = new RegExp(
  `^[A-Z0-9]{${BASE_MIN_LENGTH},${BASE_MAX_LENGTH}}$`,
);

/** A sealed unit's stored serial. `lib/inboundQc.ts` re-exports these. */
export const SERIAL_MIN_LENGTH = BASE_MIN_LENGTH;
export const SERIAL_MAX_LENGTH = BASE_MAX_LENGTH;

/**
 * The longest a serial FIELD will take — the box's `maxLength`, not a rule.
 *
 * A second-hand unit's serial is taken as read and held to no length (owner,
 * 2026-09-21), so the box has to be generous: a box that stopped short would
 * silently swallow the end of one, and nothing on screen would say so. Twice
 * Apple's longest barcode, which is also where two scans with no Enter between
 * them end up.
 */
export const SERIAL_FIELD_MAX_LENGTH = 23;

/**
 * The letters Apple leaves out of a serial. On a sealed unit an `I` or an `O`
 * can only be a `1` or a `0` somebody — or something — misread.
 */
export const CONFUSABLE_LETTERS = ["I", "O"] as const;

/** What each of them was really looking at. `I` is a one, `O` is a zero. */
const CONFUSABLE_FIX: Readonly<Record<string, string>> = { I: "1", O: "0" };

/**
 * Read `I` as `1` and `O` as `0`.
 *
 * Apple prints neither letter in a serial, so on a SEALED unit there is exactly
 * one thing each can have been, and the correction is not a guess. Applied to
 * a scan since the morning of 2026-09-21 and to a typed serial since that
 * afternoon (owner: "corrected to 1/0"). Never applied to a second-hand unit,
 * whose serial is taken as read.
 */
export function correctScanConfusables(value: string): string {
  return value.replace(/[IO]/g, (c) => CONFUSABLE_FIX[c] ?? c);
}

/**
 * The symbology the shop's scanner is expected to be set to.
 *
 * A keyboard-wedge scanner hands over characters and nothing else — there is
 * no symbology byte in a keystroke, so no function can *verify* this from this
 * side of the wire. Naming it gives a run of failures somewhere to point.
 */
export const CODE128_HINT = "Code 128";

/**
 * Trim, upper-case, and drop blanks — all a read needs before it is judged.
 *
 * Blanks INSIDE go too: no serial has one, and "C02 7401 37JK" typed off a
 * sticker that groups its characters is the same unit as "C027401 37JK".
 */
export function normaliseScan(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Why a sealed unit's serial or scan was refused. One sentence per reason at a call site. */
export type ScanRejection =
  /** Nothing at all. */
  | "empty"
  /** Right characters, wrong size — the serial is not ten to twelve. */
  | "length"
  /** A symbol or a punctuation mark — not capitals and digits. */
  | "charset"
  /**
   * A SCAN that does not begin with `S`.
   *
   * Its own reason because the remedy is a different action: aim at a
   * different barcode. The underside of a box carries a regulatory code and a
   * part number of much the same shape, and the marker is what tells them
   * apart.
   */
  | "no-marker";

export type ScanResult =
  | {
      readonly ok: true;
      /** The cleaned-up read, after any `I`/`O` repair. */
      readonly scanned: string;
      /** The serial inside the barcode — the read without its `S`. */
      readonly serial: string;
      /** The read carried an `I` or an `O` and was repaired. */
      readonly corrected: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: ScanRejection;
      /** The cleaned-up scan, so a message can quote what actually arrived. */
      readonly scanned: string;
      /** Its length, for the messages that need to say a number. */
      readonly length: number;
    };

/**
 * Read one of Apple's serial barcodes — a sealed unit's, strictly.
 *
 * `I`/`O` are repaired first, so the length window and the serial that comes
 * back are about the same string; then the read must be `S` and ten to twelve,
 * and what comes back is the ten to twelve.
 */
export function readBarcode(raw: string): ScanResult {
  const read = normaliseScan(raw);
  const scanned = correctScanConfusables(read);
  const corrected = scanned !== read;
  const fail = (reason: ScanRejection): ScanResult => ({
    ok: false,
    reason,
    scanned,
    length: scanned.length,
  });

  if (scanned === "") return fail("empty");
  if (!/^[A-Z0-9]+$/.test(scanned)) return fail("charset");
  if (!scanned.startsWith(SCAN_PREFIX)) return fail("no-marker");
  const serial = scanned.slice(SCAN_PREFIX.length);
  const bad = judgeBare(serial);
  if (bad) return fail(bad);
  return { ok: true, scanned, serial, corrected };
}

/** What is wrong with something claiming to be a sealed unit's serial, or null. */
function judgeBare(value: string): ScanRejection | null {
  if (value === "") return "empty";
  if (!/^[A-Z0-9]+$/.test(value)) return "charset";
  if (value.length < BASE_MIN_LENGTH || value.length > BASE_MAX_LENGTH) {
    return "length";
  }
  return null;
}

/**
 * Read a serial somebody TYPED for a sealed unit.
 *
 * `I`/`O` become `1`/`0` (owner answer, 2026-09-21). A typed serial is the
 * number off the case, ten to twelve — except that a string that is exactly
 * Apple's BARCODE (`S` and then ten to twelve) is read as one, marker and all,
 * and the `S` is dropped. That is somebody copying the line under the bars, or
 * a scanner slow enough to pass for a hand; either way the `S` is not part of
 * the serial. It cannot swallow a real ten-character serial that starts with
 * an `S`: without its first letter that is nine, which is no barcode.
 */
export function readTypedSealed(raw: string): ScanResult {
  const read = normaliseScan(raw);
  const typed = correctScanConfusables(read);
  const corrected = typed !== read;
  const fail = (reason: ScanRejection): ScanResult => ({
    ok: false,
    reason,
    scanned: typed,
    length: typed.length,
  });
  if (typed === "") return fail("empty");
  if (ORIGINAL_PATTERN.test(typed)) {
    return {
      ok: true,
      scanned: typed,
      serial: typed.slice(SCAN_PREFIX.length),
      corrected,
    };
  }
  const bad = judgeBare(typed);
  if (bad) return fail(bad);
  return { ok: true, scanned: typed, serial: typed, corrected };
}

/**
 * Is this a serial a sealed unit may be stored under?
 *
 * `strict` is the sealed reading — ten to twelve capitals and digits. The
 * lenient one is the second-hand reading, which asks only that there is
 * something there: a second-hand serial is taken as read (owner, 2026-09-21).
 * Defaults to strict, so a caller that has not thought about it gets the
 * safer answer.
 */
export function validateSerial(
  serial: string,
  { strict = true }: ValidateOptions = {},
): ScanRejection | null {
  const clean = normaliseScan(serial);
  if (clean === "") return "empty";
  if (!strict) return null;
  return judgeBare(clean);
}

/** What `validateSerial` is being asked. */
export interface ValidateOptions {
  /** Hold the serial to a sealed unit's shape? */
  readonly strict?: boolean;
}

/** Convenience: is this a serial the database is allowed to hold? */
export function isValidSerial(
  serial: string,
  options?: ValidateOptions,
): boolean {
  return validateSerial(serial, options) === null;
}

/** What is wrong with a serial that is about to be printed. */
export type SerialFault =
  /** Nothing to encode. A sticker cannot be made from this. */
  | "empty"
  /** Characters no barcode on a label can carry. */
  | "unencodable"
  /** Has an `I` or an `O`, which Apple never prints. */
  | "confusable"
  /** Something other than a capital or a digit — a space, a dash, a slash. */
  | "charset";

export interface SerialInspection {
  readonly fault: SerialFault;
  /**
   * `error` means the sticker cannot be printed: there is no code to draw, or
   * nothing that would draw would scan back. `warning` means it will print and
   * scan perfectly well — but the serial ITSELF looks wrong, and a sticker is
   * the last cheap moment to notice.
   */
  readonly level: "error" | "warning";
}

/**
 * Look at a serial the shop is about to put on a sticker.
 *
 * An **error** is a serial no sticker can carry — empty, or characters the
 * symbology cannot encode. A **warning** is a serial that will print and scan
 * back perfectly but has a character Apple never uses. There is no warning
 * about LENGTH any more: a second-hand serial is taken as read (2026-09-21),
 * so no length is wrong, and a sealed one was held to its shape on the way in.
 *
 * Returns `null` when there is nothing to say.
 */
export function inspectStoredSerial(serial: string): SerialInspection | null {
  const clean = serial.trim();
  if (clean === "") return { fault: "empty", level: "error" };
  // Anything outside printable ASCII cannot go into a Code 128 at all, and in
  // a QR it would encode bytes that come back out of a cheap imager as
  // something else. Either way the sticker would not be about this unit.
  if (!/^[\x20-\x7e]+$/.test(clean)) {
    return { fault: "unencodable", level: "error" };
  }
  if (!/^[A-Z0-9]+$/.test(clean)) return { fault: "charset", level: "warning" };
  if (CONFUSABLE_LETTERS.some((c) => clean.includes(c))) {
    return { fault: "confusable", level: "warning" };
  }
  return null;
}

/** Can a sticker be made for this serial at all? */
export function isPrintableSerial(serial: string): boolean {
  return inspectStoredSerial(serial)?.level !== "error";
}

/**
 * A supplier's suggested code, from its name — `CV Apel Segar` → `AS`.
 *
 * Only a suggestion, offered when a supplier is added, because the shop's own
 * codes are the shop's to choose and two suppliers can easily suggest the
 * same two letters. Legal-form words are dropped first: `PT`, `CV` and `UD`
 * are on the front of half the suppliers in Indonesia and a scheme where three
 * of them are `PT` is no scheme at all.
 */
const LEGAL_FORMS = new Set(["PT", "CV", "UD", "PD", "TB", "TOKO"]);

export function suggestSupplierCode(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !LEGAL_FORMS.has(w));
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).padEnd(2, "X");
  return `${words[0]![0]}${words[1]![0]}`;
}
