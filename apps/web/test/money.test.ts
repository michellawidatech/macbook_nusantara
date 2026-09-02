/**
 * The money input's display, pinned to the read-only display beside it.
 *
 * These two halves — `moneyFormatter` for what an input SHOWS, `fmtRp` for
 * what a table cell shows — already carried comments in both files promising
 * they agreed, and they disagreed anyway for as long as both existed: the
 * input grouped with commas (inherited from the Taiwan build this was ported
 * from, along with a `TWD_SYMBOL` whose value had been changed to "Rp" while
 * its grouping never was) and the table grouped with dots. A comment cannot
 * fail, so the promise is made executable here.
 *
 * It matters past consistency. 02 §9 fixes the display as `Rp 4.200.000`, and
 * in Indonesian convention the comma is the DECIMAL separator — so "4,200,000"
 * did not merely look different from the row beneath it, it read as a
 * different number to the staff typing it. `packages/domain`'s `parseRupiah`
 * refuses to guess at precisely this ambiguity.
 */

import { describe, expect, it } from "vitest";
import {
  RP_SYMBOL,
  moneyFormatter,
  moneyParser,
} from "../src/components/money.js";
import { fmtRp } from "../src/lib/format.js";

/** antd hands the formatter an info argument this module never reads. */
const format = (value: number | string | undefined): string =>
  moneyFormatter(value as number, { userTyping: false, input: "" });

/** `moneyParser` returns a string through a cast — see its docblock. */
const parse = (display: string | undefined): string =>
  moneyParser(display as string) as unknown as string;

/** Whole rupiah a shop actually types, plus the boundaries around grouping. */
const AMOUNTS = [0, 1, 999, 1000, 1500000, 4200000, 12345678901, -1000];

describe("the input display agrees with the read-only display", () => {
  it.each(AMOUNTS)("%d formats the same in both halves", (amount) => {
    expect(fmtRp(amount)).toBe(`${RP_SYMBOL} ${format(amount)}`);
  });

  // The regression itself, named: the two observed values from the report.
  it("groups with dots, not commas", () => {
    expect(format(4200000)).toBe("4.200.000");
    expect(format(1500000)).toBe("1.500.000");
    expect(format(4200000)).not.toContain(",");
  });

  it("leaves a number below the grouping boundary alone", () => {
    expect(format(999)).toBe("999");
  });

  it("keeps a minus sign outside the grouping", () => {
    expect(format(-1000)).toBe("-1.000");
    expect(format(-1234567)).toBe("-1.234.567");
  });
});

describe("what the input shows round-trips back to what it stores", () => {
  it.each(AMOUNTS)("%d survives format then parse", (amount) => {
    expect(parse(format(amount))).toBe(String(amount));
  });

  // 02 §9: "Rejecting `4.200.000` because of dots is the kind of small cruelty
  // that makes staff hate a tool." Pasting a figure copied out of a table is
  // the case that motivates the tolerance.
  it.each([
    ["4.200.000", "4200000"],
    ["Rp 4.200.000", "4200000"],
    ["Rp 4.200.000", "4200000"],
    ["  4.200.000  ", "4200000"],
    ["rp4.200.000", "4200000"],
    ["-Rp 4.200.000", "-4200000"],
    ["4200000", "4200000"],
  ])("accepts %o", (pasted, expected) => {
    expect(parse(pasted)).toBe(expected);
  });

  it("reads a typed comma as the decimal separator", () => {
    // Indonesian convention, and what `parseRupiah` accepts. `precision={0}`
    // rounds it away on blur; the parser's job is only to not mangle it first.
    expect(parse("4.200,5")).toBe("4200.5");
    expect(format("4200.5")).toBe("4.200,5");
  });

  it("refuses to invent a number from a second comma", () => {
    // Left malformed on purpose, so `getMiniDecimal` rejects it rather than
    // this pair silently picking one of the two readings.
    expect(parse("4,200,000")).toBe("4.200,000");
  });
});

describe("the empty field stays empty", () => {
  // `Number('')` is 0, so a parser that honoured its declared return type here
  // would turn "clear this field" into "set it to zero".
  it.each([undefined, ""])("%o parses to the empty string", (value) => {
    expect(parse(value)).toBe("");
  });

  it.each([undefined, ""])("%o formats to the empty string", (value) => {
    expect(format(value)).toBe("");
  });
});

describe("fmtRp keeps its own contract", () => {
  it("renders an absent amount as a dash", () => {
    expect(fmtRp(null)).toBe("—");
    expect(fmtRp(undefined)).toBe("—");
  });
});
