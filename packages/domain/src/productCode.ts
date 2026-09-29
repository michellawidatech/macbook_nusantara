/**
 * The printed product code — `PRO 13" 2017 i5 8/128 NTB`.
 *
 * The shop reads this off a sticker at arm's length, so it is built for a
 * human squinting at 30mm of paper, not for parsing. Order is fixed and comes
 * from the owner (2026-08-24): line, size, year, chip, ram/ssd, then anything
 * else that distinguishes two otherwise identical units.
 *
 * Every part is optional and a missing one simply drops out rather than
 * leaving a gap or a placeholder. The catalogue holds accessories with no
 * screen and iPhones with no line, and `PRO  2017  8/128` with holes in it
 * reads as a bug on a label nobody can edit once it is stuck to a laptop.
 *
 * The code is *derived*, never typed. Two units with the same specs get the
 * same code because they are the same SKU — that is what makes it a SKU code
 * rather than a name.
 */

/** The pieces a code is built from, all optional. */
export interface CodeParts {
  /** Model line, already short: `PRO`, `AIR`. */
  readonly line?: string | null;
  /** Screen size in inches. `13.3` prints as `13.3"`, `13.0` as `13"`. */
  readonly sizeInch?: number | null;
  /** Release year, as a string because that is how the schema stores it. */
  readonly year?: string | null;
  /** Processor, as the shop writes it: `i5`, `M1 Pro`. */
  readonly chip?: string | null;
  /** RAM axis value, e.g. `8GB`. */
  readonly ram?: string | null;
  /** Storage axis value, e.g. `128GB`, `1TB`. */
  readonly ssd?: string | null;
  /** Anything else that separates two identical units: `NTB`, `TB`. */
  readonly extra?: string | null;
}

/**
 * `13` → `13"`, `13.3` → `13.3"`.
 *
 * The trailing `.0` is trimmed because the schema stores a Decimal(3,1) — the
 * older Pros really are 13.3 inches — but nobody writes a MacBook as `13.0"`.
 */
function formatSize(inches: number): string {
  const trimmed = Number.isInteger(inches) ? String(inches) : String(inches);
  return `${trimmed.replace(/\.0$/, "")}"`;
}

/**
 * `8GB` → `8`, `256GB` → `256`, `1TB` → `1TB`.
 *
 * GB is the assumed unit and dropping it is what makes `8/128` short enough to
 * fit. TB is kept: `8/1` beside `8/128` would read as the smallest drive in
 * the shop rather than the largest.
 */
function formatCapacity(value: string): string {
  const gb = /^(\d+)\s*GB$/i.exec(value.trim());
  return gb ? gb[1]! : value.trim();
}

/**
 * Builds the code, skipping whatever is missing.
 *
 * RAM and SSD are a single part rather than two: `8/128` is one fact about the
 * machine, and if only one of them is known then `8/` or `/128` would be worse
 * than printing the one that is.
 */
export function productCode(parts: CodeParts): string {
  const ram = parts.ram ? formatCapacity(parts.ram) : null;
  const ssd = parts.ssd ? formatCapacity(parts.ssd) : null;
  const storage = ram && ssd ? `${ram}/${ssd}` : (ram ?? ssd);

  return [
    parts.line?.trim(),
    typeof parts.sizeInch === "number" ? formatSize(parts.sizeInch) : null,
    parts.year?.trim(),
    parts.chip?.trim(),
    storage,
    parts.extra?.trim(),
  ]
    .filter((p): p is string => Boolean(p))
    .join(" ");
}

/**
 * Splits a code for the label, which gives it two lines beside the QR.
 *
 * The break goes before the chip, so the top line is what the machine *is*
 * (`PRO 13" 2017`) and the second is how it is configured (`i5 8/128 NTB`).
 * That matches the owner's example, and it means the top line stays stable
 * across every variant of one model — which is what someone scanning a shelf
 * is actually matching against.
 */
export function productCodeLines(parts: CodeParts): [string, string] {
  const head = productCode({
    line: parts.line,
    sizeInch: parts.sizeInch,
    year: parts.year,
  });
  const tail = productCode({
    chip: parts.chip,
    ram: parts.ram,
    ssd: parts.ssd,
    extra: parts.extra,
  });
  return [head, tail];
}

/*
 * =============================================================================
 * The shop's own naming convention (owner ask 2026-09-21)
 * =============================================================================
 *
 * > *"In the SKU and product input, actually they use the naming convention in
 * > stock persediaan. See it in 'Export Files', and see the naming convention,
 * > e.g. MBP 13" 2020 M1."*
 *
 * The convention is B2Soft's `PERSEDIAAN BARANG` report, which the shop has
 * read its stock off for years and which the bookkeeper's own sheets start
 * from. Read off 371 rows of `Master Data Tanpa Gudang.xlsx`:
 *
 * ```
 *   AIR 13" 2020 I5 8/256          Intel: line, size, YEAR, chip, ram/ssd
 *   PRO 13" 2017 I5 8/512 TB       and a suffix where two otherwise agree
 *   AIR 13" M2 16/512              Apple silicon: the CHIP takes the year slot
 *   IMAC 24" M3 16/1TB
 *   AIR 12" 2016 M3 8/256 RETINA
 * ```
 *
 * Three rules make it what it is, and each one is a decision rather than a
 * formatting habit:
 *
 * 1. **Everything is upper case.** It is a code on a report, not prose.
 * 2. **An Apple-silicon machine prints its CHIP where an Intel one prints its
 *    YEAR, and not both.** `AIR 13" M2 16/512`, never `AIR 13" 2022 M2 …`.
 *    The shop does not say "the 2022 Air", it says "the M2 Air", and the year
 *    of an M-series machine is the thing nobody can remember.
 * 3. **RAM and storage are one part**, GB implied and TB spelled: `8/256`,
 *    `16/1TB`. `8/1` beside `8/128` would read as the smallest drive in the
 *    shop rather than the largest.
 *
 * `productCode` above is NOT this and stays as it is: it is what goes on a
 * printed sticker, its order and its lower-case `i5` are the owner's own
 * example from 2026-08-24, and labels are already on machines. This is what
 * the PRODUCT INPUT and the SKU code use, which is what was asked for.
 */

/** Chips that take the year's place — Apple silicon, in any of its spellings. */
const APPLE_SILICON = /^M\d/i;

/**
 * The first year of Apple silicon. Before it, `M3` is an INTEL Core m3.
 *
 * The collision is real and it is in this shop's own catalogue: the 12"
 * MacBook of 2016 and 2017 shipped with Core m3 and m5, written `M3` and `M5`
 * in the export exactly as an M3 MacBook Air is. `AIR 12" 2016 M3 8/256
 * RETINA` is an Intel machine, and dropping its year — which is what naming it
 * after its chip would do — would leave `AIR 12" M3`, a name that already
 * belongs to something else.
 */
const APPLE_SILICON_FROM = 2020;

/** Is this chip one the shop names a machine by instead of its year? */
export function isAppleSilicon(
  chip: string | null | undefined,
  year?: string | number | null,
): boolean {
  if (!APPLE_SILICON.test((chip ?? "").trim())) return false;
  const y = Number(year ?? NaN);
  // A year we do not have cannot argue with the chip.
  return !Number.isFinite(y) || y >= APPLE_SILICON_FROM;
}

/**
 * A product's name in the shop's own convention — `AIR 13" 2020 I5 8/256`.
 *
 * Every part optional, and a missing one drops out rather than leaving a gap:
 * the catalogue holds accessories with no screen and iPads with no chip, and
 * `AIR  2020  8/256` with holes in it reads as a bug.
 */
export function shopProductName(parts: CodeParts): string {
  const chip = parts.chip?.trim().toUpperCase() ?? "";
  // Rule 2: the chip replaces the year on an Apple-silicon machine — and a
  // pre-2020 `M3` is an Intel Core m3, which keeps its year.
  const year = isAppleSilicon(chip, parts.year)
    ? ""
    : (parts.year?.trim() ?? "");
  const ram = parts.ram ? formatCapacity(parts.ram) : null;
  const ssd = parts.ssd ? formatCapacity(parts.ssd) : null;
  const storage = ram && ssd ? `${ram}/${ssd}` : (ram ?? ssd);

  return [
    parts.line?.trim(),
    typeof parts.sizeInch === "number" ? formatSize(parts.sizeInch) : null,
    year,
    chip,
    storage,
    parts.extra?.trim(),
  ]
    .filter((p): p is string => Boolean(p && p.trim() !== ""))
    .join(" ")
    .toUpperCase();
}

/**
 * Read one of those names back into its parts.
 *
 * The import needs this and so does anything that ever has to reconcile the
 * shop's catalogue against B2Soft's: the export gives 371 names in this
 * convention and nothing else, so the only way to get a model, a size, a year
 * and two capacities out of one is to read it.
 *
 * Deliberately forgiving about what it does NOT recognise. A name it cannot
 * parse comes back with `line` holding the whole string and everything else
 * absent, which is the honest answer for `KOLI`, `JASA SERVICE` and
 * `FLEXYBEL BATTERY A1708` — accessories and spare parts, which follow no
 * convention because there is nothing to configure about them.
 */
export interface ParsedProductName {
  /** What was recognised; the whole input when nothing was. */
  readonly line: string;
  readonly sizeInch?: number;
  readonly year?: string;
  readonly chip?: string;
  readonly ram?: string;
  readonly ssd?: string;
  readonly extra?: string;
  /** True when the size, the configuration and a chip or a year were all found. */
  readonly recognised: boolean;
}

/**
 * `8/256` → 8GB and 256GB; `16/1TB` → 16GB and 1TB; `16/1,5TB` → 1.5TB.
 *
 * The unit is glued to the number with NO space, and that is load-bearing:
 * `8/512 TB` is a 512GB drive on a touch-bar machine, and allowing a space
 * would read it as a half-terabyte and swallow the suffix. Every row in the
 * export writes `1TB` closed up, and every touch-bar suffix with a space
 * before it.
 */
const CONFIG = /\b(\d{1,3})\s*\/\s*(\d{1,3}(?:[.,]\d)?)(TB|GB)?\b/i;
/**
 * `13"`, `13.3"`, `27 inch`.
 *
 * No trailing `\b` after the quote: a double quote is not a word character,
 * so `13" 2020` has no boundary between the quote and the space and the match
 * would fail on every MacBook in the shop.
 */
const SIZE = /\b(\d{1,2}(?:[.,]\d)?)\s*(?:"|''|INCH\b|IN\b)/i;
const YEAR = /\b(20[0-3]\d)\b/;
/** The storage sizes Apple actually ships, so a year is never read as one. */
const STORAGE_SIZES = new Set([16, 32, 64, 128, 256, 512, 1024]);

/** `I5`, `I7`, `M1`, `M2 PRO`, `M3 PRO MAX`, `CORE M`. */
const CHIP = /\b(I[3579]|M\d(?:\s+(?:PRO|MAX|ULTRA))*|CORE\s+M)\b/i;

export function parseProductName(raw: string): ParsedProductName {
  const text = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (text === "") return { line: "", recognised: false };

  const config = CONFIG.exec(text);
  const size = SIZE.exec(text);
  const year = YEAR.exec(text);
  const chip = CHIP.exec(text);

  /*
   * An iPad has storage and no RAM — `IPAD PRO 13" M4 256`,
   * `IPAD MINI 6 GEN 2021 64GB` — so the configuration is one number at the
   * end rather than a pair. Only when a size and a chip or a year were also
   * found: without that guard, `MAGSAFE 2 85W` would read as 85GB of storage.
   */
  const bare =
    config === null && size !== null && chip !== null
      ? /\b(\d{2,4})\s*(TB|GB)?$/i.exec(text)
      : null;
  /*
   * A trailing number with no unit is storage only when it IS a storage size.
   * Without this rule `BATTERY A1398 PRO 15" 2015` reads as a 2015GB drive:
   * a spare part carries a size and a year and nothing else, which is exactly
   * the shape a machine has. No storage size is also a year, so the two never
   * collide.
   */
  const bareIsStorage =
    bare !== null &&
    (bare[2] !== undefined || STORAGE_SIZES.has(Number(bare[1])));

  if (!config && !bareIsStorage) {
    // No configuration: an accessory, a spare part or a service line. There is
    // nothing to take apart, so it is its own name.
    return { line: text, recognised: false };
  }

  const at = config ? config.index : bare!.index;
  const length = config ? config[0].length : bare![0].length;
  const ram = config ? `${config[1]}GB` : undefined;
  // The separator is kept as the shop typed it. `1,5TB` is how the 2018 Air's
  // odd drive is written on every sheet in the shop, and rewriting it to
  // `1.5TB` would make the name that comes out differ from the one that went
  // in — which is the one thing an import must not do.
  const ssd = config
    ? `${config[2]!}${(config[3] ?? "GB").toUpperCase()}`
    : `${bare![1]}${(bare![2] ?? "GB").toUpperCase()}`;

  /*
   * The LINE is whatever comes before the first thing that is a
   * specification. That is how `M1 PRO 14" 16/1TB` works out to a line of
   * "M1 PRO": the shop really does name that machine after its chip, and
   * inventing a line of "PRO" for it would file it beside the Intel Pros.
   */
  const marks = [size?.index, year?.index, chip?.index, at].filter(
    (i): i is number => typeof i === "number",
  );
  let head = text.slice(0, Math.min(...marks)).trim();
  /*
   * `M1 PRO MAX 16" 64/2TB` leaves nothing in front, because the chip IS the
   * front. The shop really does name that machine after its chip, so the chip
   * becomes the line and stops being a separate part — otherwise rebuilding
   * the name would print it twice.
   */
  let chipPart = chip?.[1]?.replace(/\s+/g, " ");
  if (head === "" && chip !== null && chip.index === 0) {
    // CHIP has one capture group and it is not optional.
    head = chipPart!;
    chipPart = undefined;
  }

  /*
   * The SUFFIX is what is left after the configuration — `NTB`, `TB`,
   * `RETINA`, `NEW`. A bare `TB` here is the touch bar and not a terabyte: the
   * terabyte is inside the configuration and has already been consumed.
   */
  const tail = text.slice(at + length).trim();

  return {
    line: head,
    ...(size ? { sizeInch: Number(size[1]!.replace(",", ".")) } : {}),
    ...(year ? { year: year[1]! } : {}),
    ...(chipPart ? { chip: chipPart } : {}),
    ...(ram ? { ram } : {}),
    ssd,
    ...(tail === "" ? {} : { extra: tail }),
    // A machine has a size, a configuration AND a chip. All three, because a
    // spare part has the first two and an accessory has none.
    recognised: Boolean(size && chip),
  };
}
