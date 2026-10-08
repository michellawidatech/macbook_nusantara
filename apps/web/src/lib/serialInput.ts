/**
 * One serial field, two kinds of hand, two kinds of unit — and the rule that
 * says what to do about each.
 *
 * ## The owner's rules, 2026-09-21 (this REPLACES every earlier table)
 *
 * *"New item, scan: must be validated against the S and 10–12 characters and
 * 1 and 0 instead of I or O. After that the S will be removed from the scanned
 * result. New item, typed: validated against 10–12 and 1 and 0. Second,
 * scanned: no validation. Second, typed: no validation."* — and the same
 * afternoon, *"delete the supplier auto-append in serial number"*.
 *
 * | | sealed (`NEW`) | second-hand (A/B/C) |
 * |---|---|---|
 * | scanned | `S` + 10–12, `I`/`O` → `1`/`0`, the `S` dropped | as read |
 * | typed | 10–12, `I`/`O` → `1`/`0` | as read |
 *
 * "As read" is trimmed and upper-cased and nothing else — no length, no
 * alphabet, no marker. A second-hand label has been through however many
 * owners and the number the shop can read off it is the only number there is.
 *
 * ## The serial waits for the condition (owner answer, 2026-09-21)
 *
 * The rule depends on the condition and the bench can reach the serial box
 * first. So a serial read before its unit has a grade is not judged at all:
 * `readSerialInput` answers `needs-grade`, the caller holds the text as it
 * arrived (and whether it was a scan), and judges it the moment a grade is
 * picked. Nothing is minted in between — a unit filed under the second-hand
 * reading and then graded New would be a sealed unit whose serial nobody
 * checked.
 *
 * ## Why speed is the evidence
 *
 * A keyboard-wedge scanner sends keystrokes and nothing else — there is no
 * symbology byte in a keypress — so the only thing that distinguishes a scan
 * from a hand is how fast the characters arrived. `lib/scanner.ts` is already
 * measuring that for its routing, and `wasScannedText` answers from that
 * record rather than timing the same characters twice.
 *
 * ## Read-only boxes validate nothing
 *
 * *"For read only scanning/typing, there should not be any validation in
 * barcode."* A SEARCH box — the till, S/N Tracking, stock opname, the return
 * desk — goes through `resolveSerialQuery`, which refuses nothing and invents
 * nothing: it tries each reading of the input against what the shop holds.
 *
 * Pure: no React, no store, no DOM. `test/serialInput.test.ts` is the spec.
 */
import { isNew } from "./condition.js";
import {
  BARE_PATTERN,
  ORIGINAL_PATTERN,
  SCAN_PREFIX,
  correctScanConfusables,
  normaliseScan,
  readBarcode,
  readTypedSealed,
  type ScanRejection,
} from "./serialScan.js";

/** Where the characters came from, as far as this module is concerned. */
export type SerialSource = "scan" | "typed";

/** Which rule a serial is held to. Undefined: nobody has said yet. */
export type SerialCondition = "NEW" | "SECOND";

/**
 * The rule a unit's grade puts its serial under: `NEW` is sealed, any other
 * grade is second-hand, and no grade is no answer yet — the serial waits.
 */
export function serialConditionOf(
  grade: string | null | undefined,
): SerialCondition | undefined {
  if (grade === undefined || grade === null || grade.trim() === "") {
    return undefined;
  }
  return isNew(grade) ? "NEW" : "SECOND";
}

export interface SerialInputOptions {
  /**
   * Did this text arrive as a burst? `wasScannedText` in `lib/scanner.ts`.
   *
   * Required rather than defaulted, and deliberately: a caller that forgets it
   * would silently get the typed rules on a scanner. Making it explicit means
   * every field has answered the question.
   */
  readonly scanned: boolean;
  /**
   * The unit's condition — `serialConditionOf(grade)` at Inbound, the dialog's
   * own control on a trade-in. Undefined answers `needs-grade`.
   */
  readonly condition: SerialCondition | undefined;
}

/** Why a serial could not be filed — a refusal, or "not yet". */
export type SerialInputRefusal = ScanRejection | "needs-grade";

export type SerialInputResult =
  | {
      readonly ok: true;
      /** What `Unit.serial` holds. */
      readonly serial: string;
      readonly source: SerialSource;
      /** True when a barcode's `S` was taken off. */
      readonly unmarked: boolean;
      /** True when an `I` or `O` was read as `1` or `0`. */
      readonly corrected: boolean;
    }
  | {
      readonly ok: false;
      /**
       * `needs-grade` is not a fault — the serial is held until the unit has
       * a condition. Everything else is a refusal of a sealed unit's serial.
       */
      readonly reason: SerialInputRefusal;
      readonly source: SerialSource;
      /** The cleaned-up input, so a message can quote what arrived. */
      readonly input: string;
    };

/**
 * Read one serial out of a field, under the rules for this unit and this hand.
 */
export function readSerialInput(
  raw: string,
  { scanned, condition }: SerialInputOptions,
): SerialInputResult {
  const input = normaliseScan(raw);
  const source: SerialSource = scanned ? "scan" : "typed";

  if (input === "") return { ok: false, reason: "empty", source, input };
  if (condition === undefined) {
    return { ok: false, reason: "needs-grade", source, input };
  }

  if (condition === "SECOND") {
    // As read (owner, 2026-09-21): no marker taken off, no letter mapped, no
    // length — the label has been through however many owners.
    return {
      ok: true,
      serial: input,
      source,
      unmarked: false,
      corrected: false,
    };
  }

  const read = scanned ? readBarcode(input) : readTypedSealed(input);
  if (!read.ok) return { ok: false, reason: read.reason, source, input };
  return {
    ok: true,
    serial: read.serial,
    source,
    unmarked: read.serial.length < read.scanned.length,
    corrected: read.corrected,
  };
}

/**
 * Every string a scanned or typed serial could be stored as, most literal
 * first.
 *
 * 1. **The input itself** — a second-hand serial is stored as read, and the
 *    shop's sticker prints the stored serial, so this is the ordinary case.
 * 2. **Without its marker** — Apple's barcode of a sealed unit, whose serial
 *    is stored without the `S` since 2026-09-21.
 * 3. **With a marker** — a serial read off the case, of a unit filed with its
 *    `S` between 2026-09-01 and 2026-09-21 (and every unit of the demo seed).
 * 4. **The same three with `I`/`O` read as `1`/`0`** — a scanner that misread
 *    a sealed unit's label, which was stored repaired.
 * 5. **A 2026-09-01 store sticker** — two letters in front of Apple's barcode
 *    — should one ever have been printed.
 */
function readingsOf(input: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s !== "" && !out.includes(s)) out.push(s);
  };
  const around = (s: string) => {
    add(s);
    if (ORIGINAL_PATTERN.test(s)) add(s.slice(SCAN_PREFIX.length));
    if (BARE_PATTERN.test(s)) add(`${SCAN_PREFIX}${s}`);
  };
  around(input);
  around(correctScanConfusables(input));
  if (/^[A-Z]{2}S[A-Z0-9]{10,12}$/.test(input)) around(input.slice(2));
  return out;
}

/**
 * Turn whatever somebody put in a SEARCH box into a serial the shop holds.
 *
 * A search box invents nothing and refuses nothing (owner, 2026-09-21: *"for
 * read only scanning/typing, there should not be any validation"*). It tries
 * every reading of the input (`readingsOf`) against what the shop actually has
 * and hands back the first one that names something — and hands the input
 * straight back when nothing matches, so the caller reports "not found".
 *
 * `supplierCodes` is accepted and ignored since the store sticker went
 * (2026-09-21) — its callers are many and none of them is wrong to pass it.
 */
export function resolveSerialQuery(
  raw: string,
  known: Iterable<string>,
  _supplierCodes: Iterable<string> = [],
): string {
  const input = normaliseScan(raw);
  if (input === "") return input;

  const serials = new Set<string>();
  for (const s of known) serials.add(normaliseScan(s));
  for (const reading of readingsOf(input)) {
    if (serials.has(reading)) return reading;
  }
  return input;
}

/**
 * The one serial a box NAMES outright — or null.
 *
 * `resolveSerialQuery` answers "which stored serial is this?"; a box that ACTS
 * on the answer the moment it has one (the till's search, owner ask
 * 2026-09-21: *"when we type in serial number, we should automatically add the
 * unit"*) must also ask "has the person finished typing?". A serial that is the
 * head of a longer stored one is not an answer yet: typing `C02740137JKM`
 * passes through `C02740137JK` on the way, and if the shop holds both, grabbing
 * the shorter one there would sell the wrong unit.
 */
export function serialNamedBy(
  raw: string,
  known: Iterable<string>,
): string | null {
  const input = normaliseScan(raw);
  if (input === "") return null;
  const serials = new Set<string>();
  for (const s of known) serials.add(normaliseScan(s));

  const readings = readingsOf(input);
  const hit = readings.find((r) => serials.has(r));
  if (hit === undefined) return null;
  for (const s of serials) {
    if (s === hit) continue;
    if (readings.some((r) => s.length > r.length && s.startsWith(r))) {
      return null;
    }
  }
  return hit;
}

/**
 * Does a part-typed serial FILTER to this one? The till's serial chooser
 * (owner ask 2026-10-08) narrows its list as somebody types.
 *
 * A substring, not a whole serial, and through the same readings a search
 * box uses — with and without the barcode's `S`, and `I`/`O` read as `1`/`0`
 * — so the case and the barcode both find the unit. An empty query matches
 * everything.
 */
export function serialMatchesQuery(raw: string, serial: string): boolean {
  const input = normaliseScan(raw);
  if (input === "") return true;
  const stored = normaliseScan(serial);
  return readingsOf(input).some((r) => stored.includes(r));
}

/*
 * The COPY for a refusal lives at its call sites, not here, and that is on
 * purpose.
 *
 * `test/i18n.test.ts` finds translatable strings by reading the source for
 * literal two-argument `t()` calls. A table of keys in this file, indexed into
 * by a variable, is invisible to that scan — so an untranslated refusal would
 * show an English sentence in the middle of an Indonesian screen and nothing
 * would fail. Each desk that refuses a serial therefore writes its own calls
 * out (`InboundDetailPage`'s `serialFaultText`, the trade-in dialog's
 * validator), and the test reviews them.
 */
