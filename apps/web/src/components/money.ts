import type { InputNumberProps } from "antd";

/**
 * How a money INPUT shows and reads its number — the display half of
 * `MoneyInput`, kept in its own module because a value exported alongside a
 * component breaks Fast Refresh (the same reason `StockInPage` holds
 * `STOCK_IN_FILL_COLUMNS` rather than `StockInLineFields`).
 *
 * The read-only half lives in `lib/format.ts` as `fmtRp`. The two must
 * agree: a table cell reading "Rp 1.000" beside an input reading "1000" is
 * worse than either alone. `money.test.ts` pins them to each other, because
 * they agreed by inspection once already and drifted anyway.
 */

/**
 * The currency label.
 *
 * Deliberately NOT a translation key. The currency is rupiah whatever the
 * interface says, so "Rp" is the prefix in both languages — the same
 * reasoning `fmtRp` already records for read-only money.
 */
export const RP_SYMBOL = "Rp";

/**
 * Digit grouping for what a money input SHOWS.
 *
 * DOTS group thousands and a COMMA is the decimal separator — 02 §9, and the
 * convention every Indonesian receipt is written in. This is not cosmetic:
 * to the staff using this, "4,200,000" reads as a number with a decimal part,
 * so the comma grouping this used to emit was not merely inconsistent with the
 * table beside it, it was misleading. `packages/domain`'s `parseRupiah` is
 * strict about exactly this ambiguity — it rejects "4.2" rather than guess
 * between 4,2 and 4 200 — and this pair now speaks the same dialect.
 *
 * Display only: `moneyParser` strips the separators straight back out, so
 * nothing above the input — not the `Form.Item`'s value, not the submit
 * payload — ever sees a separator. That is the same contract
 * `MultiFillNumber`'s `toDisplay`/`fromDisplay` pair holds for the Weight
 * column's g/kg toggle, one layer further in.
 *
 * `precision` is left alone on purpose even though antd's docs say a
 * `formatter` supersedes it: rc-input-number applies precision in
 * `triggerValueUpdate`, which a custom formatter does not touch, so the value
 * is still rounded to whole rupiah on blur exactly as it was before. Only the
 * *displayed string* is ours, which is why a fraction typed mid-edit is passed
 * through verbatim rather than being reformatted under the caret.
 */
export const moneyFormatter: NonNullable<
  InputNumberProps<number>["formatter"]
> = (value) => {
  const raw = `${value ?? ""}`;
  if (raw === "") {
    return "";
  }
  // The dot arriving here is always a DECIMAL POINT, never grouping that has
  // already been applied: rc-input-number formats `MiniDecimal.toString()`
  // (`setInputValue`) and rounds with an explicit "." separator
  // (`triggerValueUpdate`), both of which are plain JS numeric strings.
  const [whole, fraction] = raw.split(".");
  // `\B` rather than `\b` keeps a leading minus out of it: "-" to "1" IS a
  // word boundary, so "-1000" groups as "-1.000" and not "-.1000".
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // The fraction comes back under a COMMA. Emitting "4.200.5" would be both
  // unreadable and unparseable — `moneyParser` strips grouping dots, so that
  // string would round-trip to 42005. `precision={0}` means this only ever
  // shows mid-edit, on the way to being rounded away on blur.
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
};

/**
 * The inverse of `moneyFormatter`.
 *
 * Tolerant on purpose, because the thing staff paste into a money field is
 * usually a figure they copied out of a table cell — "Rp 4.200.000", prefix
 * and all. 02 §9: "Rejecting `4.200.000` because of dots is the kind of small
 * cruelty that makes staff hate a tool." What it accepts is the subset of
 * `parseRupiah`'s grammar that survives being re-run on every keystroke;
 * the `4,2jt` / `4200rb` suffixes are deliberately NOT here, because
 * `parseRupiah` rejects every incomplete prefix of them and this parser runs
 * mid-typing, where "4,2j" is a state to pass through rather than refuse.
 * `packages/ui`'s rupiah-native `MoneyInput` normalizes on blur instead, which
 * is why it can afford the whole grammar.
 *
 * Returns a STRING, cast, which is what antd's own formatter demo does and is
 * load-bearing rather than sloppy: rc-input-number feeds this straight to
 * `getMiniDecimal`, which accepts `string | number`, and an emptied field has
 * to arrive there as `''` so it reads as empty and `onChange` fires `null`.
 * `Number('')` is 0, so honouring the declared return type here would turn
 * "clear this field" into "set it to zero".
 */
export const moneyParser: NonNullable<InputNumberProps<number>["parser"]> = (
  displayValue,
) =>
  (displayValue ?? "")
    // U+00A0 explicitly: `formatRupiah` puts a non-breaking space after "Rp",
    // so a figure copied out of the app arrives with one in it, and `\s` in a
    // JS regex does match it — but writing it out is the difference between
    // this surviving a future rewrite and quietly losing the case.
    .replace(/[\s\u00a0]+/g, "")
    .replace(/^(-?)rp/i, "$1")
    // Grouping out FIRST, then the decimal comma into the "." that
    // `getMiniDecimal` reads. The other order would turn every grouping dot
    // into a decimal point.
    .replace(/\./g, "")
    // Only the first comma. A second one is malformed, and leaving it in lets
    // `getMiniDecimal` reject the string rather than having us silently invent
    // a number from it.
    .replace(",", ".") as unknown as number;
