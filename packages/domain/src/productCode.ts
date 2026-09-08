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
