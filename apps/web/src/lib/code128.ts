/**
 * Code 128 — the symbology the shop's scanners are set to read, drawn as bars.
 *
 * ## Why the label needed this
 *
 * The sticker carried a QR and nothing else, and the reasoning behind it was
 * sound as far as it went: a QR holds a serial in a small square. What it did
 * not account for is what the shop actually points at the sticker. The owner's
 * scanner rules of 2026-08-28 open with *"Set Code 128 constraint"* — the
 * handhelds on the counter are 1-D imagers, and a 1-D imager cannot see a QR
 * **at all**. So the shop's own labels were the one barcode in the building
 * its own scanners could not read, which makes the supplier prefix that
 * `lib/serialScan.ts` builds unreadable on the way back in.
 *
 * ## Why it is written out rather than installed
 *
 * Code 128 is a hundred lines of table lookup and one checksum. A dependency
 * for it would be a dependency in the print path — the one path in this app
 * where a silent regression is discovered on a roll of wasted thermal stock —
 * and `test/code128.test.ts` can check the encoding directly, which is more
 * than a version bump would tell us.
 *
 * ## Subset B only, and that is not a limitation here
 *
 * Every serial this app prints is upper-case letters and digits — the alphabet
 * `serialScan.ts` enforces and the one Apple prints. Subset B covers all of
 * ASCII 32–126, so it covers every one of them. Subset C would pack digit
 * PAIRS into single symbols and make a numeric serial shorter, which sounds
 * worth having until you notice a shop serial is `AS` followed by a mixture:
 * the switching logic would earn a module or two on the rare all-digit tail
 * and could get a label wrong on every other one.
 *
 * ## What comes out
 *
 * Module WIDTHS, not pixels: `[2,1,2,2,...]` is "2 units of bar, 1 of space, 2
 * of bar…", always starting with a bar. The caller multiplies by whatever a
 * module is worth on its paper, which is the whole reason this returns a
 * pattern rather than an SVG — a 50mm sticker and an 80mm thermal label want
 * the same bars at different widths, and rounding that decision into this file
 * is what makes a barcode that scans on screen and fails on paper.
 *
 * Pure: no React, no DOM.
 */

/**
 * The 107 Code 128 symbols, as bar/space run lengths.
 *
 * Index is the symbol VALUE, which is also what the checksum is computed over.
 * Each string is six digits: bar, space, bar, space, bar, space — eleven
 * modules in total, every symbol the same width, which is what makes the
 * symbology self-checking.
 *
 * Transcribed from the ISO/IEC 15417 table. Values 0–94 are subset B's
 * printable ASCII in order (value = code point − 32), 95–102 are the control
 * and shift symbols, and 103–106 are the three start codes and the stop.
 */
const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "233111",
] as const;

/** Subset B's start symbol. */
const START_B = 104;
/** The stop symbol, whose pattern carries a thirteenth module. */
const STOP = 106;
/**
 * The stop symbol's thirteenth and fourteenth modules, as one final bar.
 *
 * Every other symbol in the table is six runs and eleven modules. The stop is
 * seven runs and thirteen — `1100011101011` — so the table's six-run row is
 * completed here with the trailing 2-module bar. It has to be a BAR: it is
 * what lets a scanner reading the symbol backwards recognise the end, and a
 * pattern that finished on white would leave nothing to terminate on.
 */
const STOP_TAIL_BAR = 2;

/** Subset B covers printable ASCII, and nothing else may be encoded. */
export function isEncodable(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text) && text.length > 0;
}

/**
 * The symbol values for a string, start code and checksum included.
 *
 * Exported for the test, which checks the checksum against the worked example
 * in the spec rather than against this function's own output.
 */
export function code128Values(text: string): number[] {
  const values = [START_B];
  for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  // The modulo-103 weighted sum: the start code counts once, then each data
  // symbol is weighted by its 1-based position.
  let sum = START_B;
  for (let i = 1; i < values.length; i += 1) sum += values[i]! * i;
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

/**
 * The bar/space module widths for a string, starting with a bar.
 *
 * Returns an empty array for anything subset B cannot carry, so a caller that
 * forgets to check renders nothing rather than a barcode that scans as
 * something else.
 */
export function code128Pattern(text: string): number[] {
  if (!isEncodable(text)) return [];
  const runs: number[] = [];
  const values = code128Values(text);
  values.forEach((v, i) => {
    const pattern = PATTERNS[v]!;
    for (const d of pattern) runs.push(Number(d));
    // The stop symbol is thirteen modules, not eleven — the trailing bar is
    // what tells a scanner reading right-to-left that it reached the end.
    if (i === values.length - 1) runs.push(STOP_TAIL_BAR);
  });
  return runs;
}

/** Total module count, quiet zones excluded. What sets the drawn width. */
export function code128Width(text: string): number {
  return code128Pattern(text).reduce((a, b) => a + b, 0);
}

/**
 * The bars only, as `{ x, width }` in modules — which is what an SVG wants.
 *
 * A renderer that walked the run lengths itself would have to remember that
 * the first run is a bar and that every other one is a space; getting that
 * wrong inverts the symbol, and an inverted Code 128 still *looks* like a
 * barcode. So the alternation is resolved once, here.
 */
export function code128Bars(text: string): { x: number; width: number }[] {
  const bars: { x: number; width: number }[] = [];
  let x = 0;
  code128Pattern(text).forEach((run, i) => {
    if (i % 2 === 0) bars.push({ x, width: run });
    x += run;
  });
  return bars;
}

/**
 * The quiet zone either side, in modules.
 *
 * Ten is the spec's minimum. It is not decoration: a Code 128 with no white
 * space around it is a Code 128 a scanner will not start reading, which on a
 * die-cut sticker is the difference between a label that works and a label
 * that works only when it happens to be peeled off straight.
 */
export const QUIET_ZONE_MODULES = 10;
