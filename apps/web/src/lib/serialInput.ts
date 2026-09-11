/**
 * One serial field, two kinds of hand — and the rule that tells them apart.
 *
 * ## The owner's rule, generalised (2026-09-08)
 *
 * *"If the input is from barcode (input speed is below a certain threshold),
 * then the barcode must be validated with S in front of it. But if the input
 * is from human, we should not require the S in the field, but the S will be
 * automatically added. That is also the same in inputting the serial number in
 * the serial number tracker or cashier or any field that can be used to search
 * serials."*
 *
 * The rule itself was settled on 2026-09-01 and lives in `lib/serialScan.ts`
 * (`markTypedSerial`, `validateSerial`) — but it was applied at exactly ONE
 * desk, Inbound & QC, written inline in that page's `commitSerial`. Every other
 * serial box in the app was either stricter or looser than the bench:
 *
 * | field | before | why it was wrong |
 * |---|---|---|
 * | S/N Tracking | exact match on a picker | a typed `C02740…` found nothing, because the store holds `SC02740…` |
 * | the till's search | `resolveScannedSerial` | strips a store prefix, never ADDS a marker — same miss |
 * | Stock Opname | `resolveScannedSerial` | same |
 * | the trade-in dialog | `markTypedSerial` unconditionally | a scan with no marker was silently marked, which is the misread the marker exists to catch |
 *
 * So the rule moves here, once, and every field asks this module instead of
 * re-deriving it. `lib/serialScan.ts` still owns the SHAPES; this owns what to
 * do about them given who typed.
 *
 * ## Why speed is the evidence
 *
 * A keyboard-wedge scanner sends keystrokes and nothing else — there is no
 * symbology byte in a keypress — so the only thing that distinguishes a scan
 * from a hand is how fast the characters arrived. `lib/scanner.ts` is already
 * measuring that for its routing, and `wasScannedText` answers from that
 * record rather than timing the same characters twice.
 *
 * And the asymmetry is the point. A BARCODE carries its marker, so a burst
 * that arrives without one was aimed at the regulatory code or the part number
 * printed beside the serial — refusing it is the whole reason the marker is
 * checked. A PERSON reads the case, where the number is printed with no marker
 * at all, so demanding one asks them to type a character that is not in front
 * of them.
 *
 * Pure: no React, no store, no DOM. `test/serialInput.test.ts` is the spec.
 */
import {
  markTypedSerial,
  normaliseScan,
  readBarcode,
  validateSerial,
  STORE_PATTERN,
  SUPPLIER_CODE_LENGTH,
  type ScanRejection,
} from "./serialScan.js";

/** Where the characters came from, as far as this module is concerned. */
export type SerialSource = "scan" | "typed";

export interface SerialInputOptions {
  /**
   * Did this text arrive as a burst? `wasScannedText` in `lib/scanner.ts`.
   *
   * Required rather than defaulted, and deliberately: a caller that forgets it
   * would silently get the typed rules on a scanner, which is the exact
   * failure this module exists to prevent. Making it explicit means every
   * field has answered the question.
   */
  readonly scanned: boolean;
  /** Origin codes the shop has issued, so a store barcode is recognisable. */
  readonly supplierCodes?: Iterable<string>;
}

export type SerialInputResult =
  | {
      readonly ok: true;
      /** Apple's barcode — what `Unit.serial` holds. */
      readonly serial: string;
      readonly source: SerialSource;
      /** True when the marker was put back on a bare typed serial. */
      readonly marked: boolean;
      /** True when the input was the shop's own sticker. */
      readonly fromStoreBarcode: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: ScanRejection;
      readonly source: SerialSource;
      /** The cleaned-up input, so a message can quote what arrived. */
      readonly input: string;
    };

/**
 * Read one serial out of a field, under the rules for whoever typed it.
 *
 * Both barcodes are accepted either way — a machine on the shelf carries both
 * and which one somebody aims at is not a decision they should have to make —
 * and what comes back is always Apple's, because that is what the database
 * holds.
 */
export function readSerialInput(
  raw: string,
  { scanned, supplierCodes = [] }: SerialInputOptions,
): SerialInputResult {
  const input = normaliseScan(raw);
  const source: SerialSource = scanned ? "scan" : "typed";

  if (input === "") return { ok: false, reason: "empty", source, input };

  if (scanned) {
    /*
     * A scan is judged as a BARCODE, marker and all. `readBarcode` handles
     * both forms and refuses a read with no marker — which is the point: a
     * burst with no `S` was aimed at the wrong barcode.
     */
    const read = readBarcode(input, { supplierCodes });
    if (!read.ok) return { ok: false, reason: read.reason, source, input };
    return {
      ok: true,
      serial: read.serial,
      source,
      marked: false,
      fromStoreBarcode: read.kind === "STORE",
    };
  }

  /*
   * A typed serial. The store barcode is stripped FIRST, because somebody
   * re-keying a graded machine reads whichever label faces them and on a
   * graded one that is the shop's own sticker — and a store barcode is never
   * a bare serial needing a marker.
   */
  const inner = isKnownStoreBarcode(input, supplierCodes)
    ? input.slice(SUPPLIER_CODE_LENGTH)
    : input;
  const marked = markTypedSerial(inner);
  const fault = validateSerial(marked);
  if (fault !== null) return { ok: false, reason: fault, source, input };
  return {
    ok: true,
    serial: marked,
    source,
    marked: marked !== inner,
    fromStoreBarcode: inner !== input,
  };
}

/** Shape AND membership — two capitals are an origin code only if we issued them. */
function isKnownStoreBarcode(
  value: string,
  supplierCodes: Iterable<string>,
): boolean {
  if (!STORE_PATTERN.test(value)) return false;
  const head = value.slice(0, SUPPLIER_CODE_LENGTH);
  for (const raw of supplierCodes) {
    if (raw.trim().toUpperCase() === head) return true;
  }
  return false;
}

/**
 * Turn whatever somebody put in a SEARCH box into a serial the store holds.
 *
 * Different from `readSerialInput` in one important way: a search box invents
 * nothing and refuses nothing. Its job is to find a machine, so it tries every
 * reading of the input against what the shop actually has and hands back the
 * first one that names something — and hands the input straight back when
 * nothing matches, so the caller reports "not found" exactly as it did before.
 *
 * The readings, in order:
 *
 * 1. **The input itself.** A read that already names a stored serial is
 *    returned untouched, so nothing here can disturb the ordinary case.
 * 2. **The barcode reading**, which strips an issued origin code off the front
 *    of the shop's own sticker.
 * 3. **The marked reading** — `C02740…` → `SC02740…` — which is what a person
 *    copying the number off the underside of a Mac types, and which
 *    `resolveScannedSerial` never covered. This is the gap the owner reported.
 * 4. **A store barcode whose code the shop no longer lists.** Its stickers are
 *    still on machines; a serial that EXISTS is proof enough on the sales
 *    floor, whatever `readBarcode` will vouch for on the way in.
 *
 * Never guesses between two machines: a reading that would match more than one
 * stored serial is not used. Today that cannot happen — the store form
 * contains the serial whole — but the check costs nothing and the alternative
 * is selling the wrong machine.
 */
export function resolveSerialQuery(
  raw: string,
  known: Iterable<string>,
  supplierCodes: Iterable<string> = [],
): string {
  const input = normaliseScan(raw);
  if (input === "") return input;

  const serials = new Set<string>();
  for (const s of known) serials.add(normaliseScan(s));
  if (serials.has(input)) return input;

  const read = readBarcode(input, { supplierCodes });
  if (read.ok && serials.has(read.serial)) return read.serial;

  const marked = markTypedSerial(input);
  if (marked !== input && serials.has(marked)) return marked;

  if (STORE_PATTERN.test(input)) {
    const inner = input.slice(SUPPLIER_CODE_LENGTH);
    if (serials.has(inner)) return inner;
    // The sticker of a retired supplier, typed without its marker.
    const innerMarked = markTypedSerial(inner);
    if (serials.has(innerMarked)) return innerMarked;
  }
  return input;
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
