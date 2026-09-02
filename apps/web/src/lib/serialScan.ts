/**
 * The two barcodes a machine carries, and which of them the database stores.
 *
 * ## The rules, restated by the owner on 2026-09-01
 *
 * The owner rewrote these and said so explicitly — *"get this right, if I have
 * said something differently pls overwrite it"* — so this file is the rules as
 * they now stand, not as they were on 2026-08-28 or 2026-08-31.
 *
 * ```
 *   S C 0 2 7 4 0 1 3 7 J K            the ORIGINAL barcode, Apple's own
 *   ^                                  the marker. Compulsory, everywhere.
 *     └────────── 10–12 ──────┘        the rest
 *
 *   A S  S C 0 2 7 4 0 1 3 7 J K       the STORE barcode, the shop's sticker
 *   ^^                                 the supplier's two-letter origin code
 *      └──── the original, whole ──┘   including its S
 * ```
 *
 * | | shape | length |
 * |---|---|---|
 * | original | `S` + 10–12 | 11–13 |
 * | store | two letters + `S` + 10–12 | 13–15 |
 *
 * ## What changed, and why it is a better model
 *
 * Until this revision the store barcode was the origin code with the `S`
 * REMOVED, and `Unit.serial` held that — so intake prefixed every scan and the
 * database never held what was printed on the machine. Two things fall out of
 * the owner's correction, and both are improvements:
 *
 * 1. **`Unit.serial` is now Apple's own barcode, exactly as read.** Nothing is
 *    appended at intake. The store barcode is DERIVED for the sticker and for
 *    display — `storeBarcodeOf` — which means the serial in the database is
 *    the string on the machine, and a machine whose supplier is corrected later
 *    does not need its serial rewritten.
 * 2. **The ambiguity is gone.** The old windows overlapped at 12 and 13
 *    characters, so a shop that ever issued an origin code beginning with `S`
 *    produced reads that were honestly both barcodes; this file used to carry
 *    a tie-break and an `ambiguous` flag for it. Keeping the `S` in the store
 *    barcode puts a marker at a known position in both — index 0 or index 2 —
 *    and no read can satisfy both, because the store form is always exactly
 *    two characters longer than the original it contains.
 *
 * ## Validation is absolute now
 *
 * The owner's words: *"if any barcode is not adhering to this rule then do not
 * accept"*. So the shape is enforced on the TYPED serial as well as on the
 * scanned one, which is a real change — the old rules deliberately let a hand
 * keyed serial through on the grounds that a person can see the machine.
 * `validateSerial` is that gate and `lib/inboundQc.ts` calls it.
 *
 * The one rule that stays scan-only is the `I`/`O` check: Apple prints neither,
 * so their presence is proof of a MISREAD, which is a statement about a scanner
 * rather than about a serial. On a typed serial it is a warning at print time
 * instead — see `inspectStoredSerial`.
 *
 * Pure: no React, no store, no DOM. `test/serialScan.test.ts` is the spec.
 */

/** The two-letter origin code every supplier carries. See `Supplier.code`. */
export const SUPPLIER_CODE_LENGTH = 2;

/** A supplier code is exactly two capitals — the same alphabet as a serial. */
export const SUPPLIER_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Apple's serial after its marker, and the only length rule in the file.
 *
 * Ten at the short end is the owner's number, and the example that forced it is
 * `SDQXFPXWCK7` — eleven characters, ten of them serial. Twelve at the long end
 * is Apple's post-2010 length.
 */
export const BASE_MIN_LENGTH = 10;
export const BASE_MAX_LENGTH = 12;

/** The marker on the front of Apple's barcode, and inside the shop's. */
export const SCAN_PREFIX = "S";

/**
 * The original barcode: `S` and then ten to twelve.
 *
 * This is also the shape of `Unit.serial`, since 2026-09-01 — the two are the
 * same string, which is the whole point of the owner's correction.
 */
export const ORIGINAL_PATTERN = new RegExp(
  `^${SCAN_PREFIX}[A-Z0-9]{${BASE_MIN_LENGTH},${BASE_MAX_LENGTH}}$`,
);

/** The store barcode: two letters, then a whole original barcode. */
export const STORE_PATTERN = new RegExp(
  `^[A-Z]{${SUPPLIER_CODE_LENGTH}}${SCAN_PREFIX}[A-Z0-9]{${BASE_MIN_LENGTH},${BASE_MAX_LENGTH}}$`,
);

/** The original barcode's window, marker included. */
export const SERIAL_MIN_LENGTH = BASE_MIN_LENGTH + 1;
export const SERIAL_MAX_LENGTH = BASE_MAX_LENGTH + 1;

/** The store barcode's window: the original plus the origin code. */
export const STORE_MIN_LENGTH = SERIAL_MIN_LENGTH + SUPPLIER_CODE_LENGTH;
export const STORE_MAX_LENGTH = SERIAL_MAX_LENGTH + SUPPLIER_CODE_LENGTH;

/**
 * The letters Apple leaves out of a serial, and therefore the letters whose
 * presence means a READ is wrong.
 */
export const CONFUSABLE_LETTERS = ["I", "O"] as const;

/**
 * A serial with no marker on it, as somebody reads it off the machine.
 *
 * The owner's rule of 2026-09-01, second revision: *"if the barcode is typed
 * and is 10–12 digit, auto-add S"*. The `S` is a marker on the BARCODE, not
 * part of the number — it is printed under the bars, not on the case — so a
 * person copying the serial off the underside of a Mac has no reason to type
 * one, and demanding it made the field refuse the number the machine actually
 * shows.
 *
 * Ten at the floor rather than eleven, and that is deliberate: the owner's own
 * example `SDQXFPXWCK7` is an `S` and then ten, and moving the floor to match
 * `OLDER_MODEL_PATTERN` would refuse every machine already taken in under one.
 */
export const BARE_PATTERN = new RegExp(
  `^[A-Z0-9]{${BASE_MIN_LENGTH},${BASE_MAX_LENGTH}}$`,
);

/**
 * What an Apple serial itself looks like, older models included.
 *
 * The owner's regex, verbatim (2026-09-01): eleven or twelve characters, and
 * no `I`, `O` or `U` anywhere in them — pre-2010 Macs carry eleven, everything
 * since carries twelve. It is deliberately NARROWER than `BARE_PATTERN` and
 * does not gate anything on its own; it is the shape `markTypedSerial` is
 * there to catch, written down so a test can say so.
 *
 * Not a rule on a typed serial that already carries its `S`. That one keeps
 * the looser alphabet, which is the 2026-09-01 decision unchanged: the `I`/`O`
 * rule exists to catch a SCANNER misreading a `1` or a `0`, and a person
 * looking at the machine is the one witness who could legitimately key either.
 */
export const OLDER_MODEL_PATTERN = /^[A-HJ-NP-TV-Z0-9]{11,12}$/;

/**
 * The symbology the shop's scanner is expected to be set to.
 *
 * A keyboard-wedge scanner hands over characters and nothing else — there is
 * no symbology byte in a keystroke, so no function can *verify* this from this
 * side of the wire. Naming it gives a run of failures somewhere to point.
 */
export const CODE128_HINT = "Code 128";

/** Which of a machine's two barcodes a read came off. */
export type BarcodeKind = "ORIGINAL" | "STORE";

/** Trim and upper-case, which is all a scan needs before it can be judged. */
export function normaliseScan(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Upper-cased, de-blanked, deduplicated — how a code list is compared. */
function codeSet(codes: Iterable<string> | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of codes ?? []) {
    const code = raw.trim().toUpperCase();
    if (SUPPLIER_CODE_PATTERN.test(code)) out.add(code);
  }
  return out;
}

/** Is this Apple's own barcode — `S` plus ten to twelve? */
export function isOriginalBarcode(value: string): boolean {
  return ORIGINAL_PATTERN.test(normaliseScan(value));
}

/**
 * Is this the shop's own sticker — an issued origin code in front of an
 * original barcode?
 *
 * Membership, not shape. Any two capitals LOOK like an origin code, and taking
 * them for one would bite two characters off the front of a barcode nobody
 * issued and call the remainder a serial. The `S` at index 2 is a second
 * guard, and between them there is nothing left to guess.
 */
export function isStoreBarcode(
  value: string,
  supplierCodes: Iterable<string>,
): boolean {
  const clean = normaliseScan(value);
  if (!STORE_PATTERN.test(clean)) return false;
  return codeSet(supplierCodes).has(clean.slice(0, SUPPLIER_CODE_LENGTH));
}

/**
 * The sticker for a serial: the supplier's origin code, then the whole serial.
 *
 * Derived, never stored (owner correction 2026-09-01). Returns null when there
 * is nothing to derive it from — an unset supplier code, or a serial that is
 * not a valid original barcode — because a half-formed store barcode on a
 * sticker is worse than no sticker: it would print, it would scan, and it
 * would scan as nothing.
 */
export function storeBarcodeOf(
  serial: string,
  supplierCode: string | undefined,
): string | null {
  const clean = normaliseScan(serial);
  const code = (supplierCode ?? "").trim().toUpperCase();
  if (!SUPPLIER_CODE_PATTERN.test(code)) return null;
  if (!ORIGINAL_PATTERN.test(clean)) return null;
  return `${code}${clean}`;
}

/** Why a serial or a scan was refused. Each maps to one sentence at a call site. */
export type ScanRejection =
  /** Nothing at all. */
  | "empty"
  /** Right shape, wrong size — the base is not ten to twelve. */
  | "length"
  /** A symbol, a space, a lower-case letter — not capitals and digits. */
  | "charset"
  /**
   * Does not begin with `S`, and is not an issued origin code in front of one.
   *
   * Its own reason because the remedy is a different action: aim at a different
   * barcode. The underside of a Mac carries a regulatory code and a part
   * number of much the same shape, and the marker is what tells them apart.
   */
  | "no-marker"
  /** Carries an `I` or an `O`, which Apple never prints. Scans only. */
  | "confusable";

export type ScanResult =
  | {
      readonly ok: true;
      /** The cleaned-up read, so a message can quote what arrived. */
      readonly scanned: string;
      /** Which of the machine's two barcodes this came off. */
      readonly kind: BarcodeKind;
      /**
       * Apple's barcode — what `Unit.serial` holds.
       *
       * The same string either way: a store read has its origin code taken
       * off, and an original read is already it.
       */
      readonly serial: string;
      /** The origin code, when the read carried one. Empty on an original. */
      readonly supplierCode: string;
    }
  | {
      readonly ok: false;
      readonly reason: ScanRejection;
      /** The cleaned-up scan, so a message can quote what actually arrived. */
      readonly scanned: string;
      /** Its length, for the messages that need to say a number. */
      readonly length: number;
    };

/** What one desk asks of a scan, on top of the rules every desk shares. */
export interface ScanOptions {
  /**
   * Every origin code the shop has issued, so the store barcode can be
   * recognised as one. Without it only Apple's barcode is readable.
   */
  readonly supplierCodes?: Iterable<string>;
}

/**
 * Read one barcode: which of the two it is, and the serial it names.
 *
 * Both forms are accepted everywhere a scan is taken, which is the owner's ask
 * of 2026-09-01 — a machine on the shelf carries both, and which one somebody
 * happens to aim at is not a decision they should have to make. What comes
 * back is always Apple's barcode, because that is what the database holds.
 *
 * No supplier argument any more, and its absence is the point: nothing is
 * prefixed at intake, so nothing here needs to know which pallet the machine
 * came off. The origin code is used to PRINT a sticker (`storeBarcodeOf`), not
 * to file a serial.
 */
export function readBarcode(
  raw: string,
  { supplierCodes }: ScanOptions = {},
): ScanResult {
  const scanned = normaliseScan(raw);
  const fail = (reason: ScanRejection): ScanResult => ({
    ok: false,
    reason,
    scanned,
    length: scanned.length,
  });

  if (scanned === "") return fail("empty");
  if (!/^[A-Z0-9]+$/.test(scanned)) return fail("charset");

  const codes = codeSet(supplierCodes);
  const looksStore =
    scanned.length > SUPPLIER_CODE_LENGTH &&
    codes.has(scanned.slice(0, SUPPLIER_CODE_LENGTH)) &&
    scanned[SUPPLIER_CODE_LENGTH] === SCAN_PREFIX;

  // The store form is checked FIRST, and the order matters exactly once: a
  // store barcode whose origin code happens to begin with `S` — `SB` say —
  // also starts with an S, and reading it as Apple's would leave `B` glued to
  // the front of the serial. Testing for the origin code first cannot make the
  // opposite mistake, because it demands a code the shop actually issued AND
  // an `S` behind it.
  if (looksStore) {
    const serial = scanned.slice(SUPPLIER_CODE_LENGTH);
    const bad = judgeOriginal(serial);
    if (bad) return fail(bad);
    return {
      ok: true,
      scanned,
      kind: "STORE",
      serial,
      supplierCode: scanned.slice(0, SUPPLIER_CODE_LENGTH),
    };
  }

  if (!scanned.startsWith(SCAN_PREFIX)) return fail("no-marker");
  const bad = judgeOriginal(scanned);
  if (bad) return fail(bad);
  return {
    ok: true,
    scanned,
    kind: "ORIGINAL",
    serial: scanned,
    supplierCode: "",
  };
}

/**
 * What is wrong with something claiming to be an original barcode, or null.
 *
 * Split out so the two branches above judge the serial identically — a store
 * barcode is an origin code in front of one of these, so anything true of the
 * inner string has to be true either way it arrived.
 */
function judgeOriginal(value: string): ScanRejection | null {
  if (!value.startsWith(SCAN_PREFIX)) return "no-marker";
  const base = value.slice(SCAN_PREFIX.length);
  if (base.length < BASE_MIN_LENGTH || base.length > BASE_MAX_LENGTH) {
    return "length";
  }
  if (!/^[A-Z0-9]+$/.test(base)) return "charset";
  if (CONFUSABLE_LETTERS.some((c) => base.includes(c))) return "confusable";
  return null;
}

/**
 * The gate on a serial somebody TYPED (owner ask 2026-09-01).
 *
 * *"If any barcode is not adhering to this rule then do not accept."* So the
 * shape is enforced on the keyboard too, which the old rules deliberately did
 * not do — they let a hand-keyed serial through on the grounds that a person
 * can see the machine. That was defensible while a wrong serial was merely
 * unfindable; it stopped being defensible once the sticker is derived from the
 * serial, because a malformed one now produces a malformed sticker.
 *
 * The `I`/`O` rule is NOT applied here and that is deliberate: it exists to
 * catch a scanner misreading a `1` or a `0`, and a person looking at the
 * machine is the one witness who could legitimately type either. It stays a
 * warning at print time — see `inspectStoredSerial`.
 *
 * Returns null when the serial is fine.
 */
export function validateSerial(serial: string): ScanRejection | null {
  const clean = normaliseScan(serial);
  if (clean === "") return "empty";
  if (!/^[A-Z0-9]+$/.test(clean)) return "charset";
  if (!clean.startsWith(SCAN_PREFIX)) return "no-marker";
  const base = clean.slice(SCAN_PREFIX.length);
  if (base.length < BASE_MIN_LENGTH || base.length > BASE_MAX_LENGTH) {
    return "length";
  }
  return null;
}

/** Convenience: is this a serial the database is allowed to hold? */
export function isValidSerial(serial: string): boolean {
  return validateSerial(serial) === null;
}

/**
 * Put the marker back on a serial somebody typed without one.
 *
 * The owner's second revision of 2026-09-01, and the distinction it turns on
 * is WHERE the two forms come from. A scanner reads a barcode, and a barcode
 * carries the `S`; if a scan has none, the scanner was aimed at the regulatory
 * code or the part number beside it, which is exactly the misread the marker
 * exists to catch — so a scan is never marked for, it is refused. A PERSON
 * reads the case, where the number is printed with no marker at all, so
 * demanding one asked them to type a character that is not in front of them.
 *
 * Hence: this is for the typed route only. `commitSerial` calls it when the
 * text did not arrive as a burst — see `wasScannedText` in `lib/scanner.ts`.
 *
 * Anything that is ALREADY a valid serial is returned untouched, and that
 * ordering is the whole subtlety. `SC02AA111AA` is eleven characters, so it is
 * both a legal marked serial (`S` + ten) and a legal bare one — and marking it
 * again would file a machine under `SSC02AA111AA`, a serial no scan of it will
 * ever match. A string that is already legal is never rewritten.
 *
 * Anything else comes back as it went in, for `validateSerial` to refuse and
 * name.
 */
export function markTypedSerial(raw: string): string {
  const clean = normaliseScan(raw);
  if (clean === "") return clean;
  // Already a serial. Never rewrite one — see the docblock.
  if (validateSerial(clean) === null) return clean;
  if (BARE_PATTERN.test(clean)) return `${SCAN_PREFIX}${clean}`;
  return clean;
}

/**
 * Turn a scan on the shop floor into the serial the database actually holds.
 *
 * A machine on the shelf carries both barcodes and the counter reads whichever
 * faces them. Sales, Stock Opname and Stock Movement all match against
 * `Unit.serial` — Apple's — so a scan of the shop's own sticker has to have its
 * origin code taken off before it can find anything.
 *
 * Much simpler than it was. It used to search the whole serial list for one
 * ending in the scanned base, because the stored form and the scanned form
 * differed by a prefix that could not be derived from the read. Now the store
 * barcode CONTAINS the serial, so taking two characters off the front is the
 * whole job and no lookup is needed.
 *
 * `known` is still taken and still consulted first, for one honest reason: a
 * read that already names a stored serial is returned untouched, so nothing
 * this function does can disturb the ordinary case.
 *
 * Returns the normalised scan unchanged when it resolves to nothing, so a
 * caller reports "unknown" exactly as it did before.
 */
export function resolveScannedSerial(
  raw: string,
  known: Iterable<string>,
  supplierCodes: Iterable<string> = [],
): string {
  const scanned = normaliseScan(raw);
  if (scanned === "") return scanned;

  const serials = new Set([...known].map((s) => normaliseScan(s)));
  if (serials.has(scanned)) return scanned;

  const read = readBarcode(scanned, { supplierCodes });
  if (read.ok && serials.has(read.serial)) return read.serial;

  /*
   * The sticker of a supplier whose code this shop no longer lists.
   *
   * `readBarcode` refuses to strip two letters it cannot vouch for, and that
   * is right for the way IN — but on the sales floor the question is only
   * whether this names a machine on a shelf, and a serial that EXISTS is proof
   * enough. A code that was retired after its stickers were printed would
   * otherwise leave those machines unscannable.
   */
  if (STORE_PATTERN.test(scanned)) {
    const inner = scanned.slice(SUPPLIER_CODE_LENGTH);
    if (serials.has(inner)) return inner;
  }
  return scanned;
}

/** What is wrong with a serial that is about to be printed. */
export type SerialFault =
  /** Nothing to encode. A sticker cannot be made from this. */
  | "empty"
  /** Characters no barcode on a label can carry. */
  | "unencodable"
  /** Has an `I` or an `O`, which Apple never prints. */
  | "confusable"
  /** Not `S` plus ten to twelve. */
  | "shape"
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
 * The scan rules guard the way IN. This guards the way out, and it is the more
 * expensive direction to get wrong: a bad scan is refused on screen with the
 * machine still in somebody's hands, whereas a bad sticker is discovered weeks
 * later, peeled onto a machine, when it will not scan or scans as the wrong
 * unit.
 *
 * An **error** is a serial no sticker can carry — empty, or characters the
 * symbology cannot encode. A **warning** is a serial that will print and scan
 * back perfectly but does not look like one this shop takes in: an `I` where a
 * `1` belongs, or a shape nothing Apple prints has. Those reach the database
 * only through data written before the rules tightened, and the shop may well
 * still have the machine — so the dialog says so and prints anyway rather than
 * leaving it with no label at all.
 *
 * Returns `null` when there is nothing to say.
 */
export function inspectStoredSerial(serial: string): SerialInspection | null {
  const clean = serial.trim();
  if (clean === "") return { fault: "empty", level: "error" };
  // Anything outside printable ASCII cannot go into a Code 128 at all, and in
  // a QR it would encode bytes that come back out of a cheap imager as
  // something else. Either way the sticker would not be about this machine.
  if (!/^[\x20-\x7e]+$/.test(clean)) {
    return { fault: "unencodable", level: "error" };
  }
  if (!/^[A-Z0-9]+$/.test(clean)) return { fault: "charset", level: "warning" };
  if (CONFUSABLE_LETTERS.some((c) => clean.includes(c))) {
    return { fault: "confusable", level: "warning" };
  }
  if (!ORIGINAL_PATTERN.test(clean)) {
    return { fault: "shape", level: "warning" };
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
