/**
 * Money — docs/rebuild/02-interaction.md §9.
 *
 * All arithmetic is BigInt whole rupiah, end to end. There is no float in this
 * file and there must never be one: `parseFloat` on money is how a shop loses
 * a hundred rupiah per sale and cannot say where.
 *
 * Pure: no I/O, no locale lookup, no clock.
 */

/** Non-breaking space. §9: "non-breaking space after `Rp`". */
const NBSP = "\u00A0";

export type MoneyParseError =
  /** Nothing to parse. */
  | "KOSONG"
  /** Not a number this app accepts. */
  | "FORMAT"
  /** Well-formed, but not a whole rupiah — e.g. "4,5". */
  | "PECAHAN";

export type MoneyParseResult =
  | { readonly ok: true; readonly value: bigint }
  | { readonly ok: false; readonly reason: MoneyParseError };

/** juta / ribu. §9 lists `4,2jt` and `4200rb` as things staff actually type. */
const SUFFIXES: readonly (readonly [RegExp, bigint])[] = [
  [/(?:juta|jt)$/, 1_000_000n],
  [/(?:ribu|rb)$/, 1_000n],
];

/**
 * Digits, optionally grouped in threes with dots, optionally with a comma
 * decimal part. Indonesian convention: dot groups thousands, comma is the
 * decimal separator.
 *
 * Grouping is checked strictly. "4.2" is rejected rather than guessed at,
 * because the two plausible readings differ by a factor of a hundred.
 */
const GROUPED = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/;
const PLAIN = /^(\d+)(?:,(\d+))?$/;

function pow10(n: number): bigint {
  let out = 1n;
  for (let i = 0; i < n; i += 1) out *= 10n;
  return out;
}

/**
 * Parse what a human typed into whole rupiah.
 *
 * Accepts `4200000`, `4.200.000`, `4,2jt`, `4200rb`, with or without an `Rp`
 * prefix, spaces anywhere, and any capitalisation. §9: "Rejecting `4.200.000`
 * because of dots is the kind of small cruelty that makes staff hate a tool."
 *
 * Total: every input produces a result, never an exception.
 */
export function parseRupiah(input: string): MoneyParseResult {
  // \s covers the non-breaking space that formatRupiah emits, so anything this
  // module prints can be pasted straight back in.
  let s = input.toLowerCase().replace(/\s/g, "");
  if (s === "") return { ok: false, reason: "KOSONG" };

  // The sign may sit on either side of the Rp marker: both "-Rp 4.200.000"
  // and "Rp -4.200.000" are things people type.
  let negative = false;
  const takeSign = (): void => {
    if (s.startsWith("-")) {
      negative = true;
      s = s.slice(1);
    }
  };

  takeSign();
  if (s.startsWith("rp")) s = s.slice(2);
  takeSign();

  // "Rp" alone is nothing typed yet; "-" alone is malformed.
  if (s === "") return { ok: false, reason: negative ? "FORMAT" : "KOSONG" };

  let multiplier = 1n;
  for (const [re, factor] of SUFFIXES) {
    if (re.test(s)) {
      multiplier = factor;
      s = s.replace(re, "");
      break;
    }
  }
  if (s === "") return { ok: false, reason: "FORMAT" };

  // The regexes validate the shape — strict about dot grouping, so "4.2" is
  // rejected rather than read as either 4,2 or 4 200.
  if (!GROUPED.test(s) && !PLAIN.test(s))
    return { ok: false, reason: "FORMAT" };

  const comma = s.indexOf(",");
  const wholeRaw = comma === -1 ? s : s.slice(0, comma);
  const fracDigits = comma === -1 ? "" : s.slice(comma + 1);

  const whole = BigInt(wholeRaw.replace(/\./g, ""));
  const scale = pow10(fracDigits.length);

  const scaled =
    (whole * scale + (fracDigits === "" ? 0n : BigInt(fracDigits))) *
    multiplier;
  if (scaled % scale !== 0n) return { ok: false, reason: "PECAHAN" };

  const value = scaled / scale;
  return { ok: true, value: negative ? -value : value };
}

/** Group digits in threes with dots: 4200000 → "4.200.000". */
export function formatNumber(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();

  let out = "";
  for (const [i, ch] of [...digits].entries()) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += ch;
  }
  return negative ? `-${out}` : out;
}

/**
 * Display form: `Rp 4.200.000` — dot thousands, no decimals, non-breaking
 * space after `Rp`. A negative sign leads the whole amount, so a loss reads
 * as `-Rp 4.200.000`.
 */
export function formatRupiah(value: bigint): string {
  return value < 0n
    ? `-Rp${NBSP}${formatNumber(-value)}`
    : `Rp${NBSP}${formatNumber(value)}`;
}
