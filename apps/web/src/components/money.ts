import type { InputNumberProps } from "antd";

/**
 * How a money INPUT shows and reads its number — the display half of
 * `MoneyInput`, kept in its own module because a value exported alongside a
 * component breaks Fast Refresh (the same reason `StockInPage` holds
 * `STOCK_IN_FILL_COLUMNS` rather than `StockInLineFields`).
 *
 * The read-only half lives in `domain/stock.ts` as `TWD.format`. The two must
 * agree: a table cell reading "NT$1,000" beside an input reading "1000" is
 * worse than either alone.
 */

/**
 * The currency label.
 *
 * Deliberately NOT a translation key. "NT$" is the standard prefix in Taiwan
 * in both languages, which is the same reasoning `TWD.format` already records
 * for read-only money.
 */
export const TWD_SYMBOL = "Rp";

/**
 * Digit grouping for what a money input SHOWS.
 *
 * Display only: `moneyParser` strips the separators straight back out, so
 * nothing above the input — not the `Form.Item`'s value, not the submit
 * payload — ever sees a comma. That is the same contract
 * `MultiFillNumber`'s `toDisplay`/`fromDisplay` pair holds for the Weight
 * column's g/kg toggle, one layer further in.
 *
 * `precision` is left alone on purpose even though antd's docs say a
 * `formatter` supersedes it: rc-input-number applies precision in
 * `triggerValueUpdate`, which a custom formatter does not touch, so the value
 * is still rounded to whole dollars on blur exactly as it was before. Only the
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
  const [whole, fraction] = raw.split(".");
  // `\B` rather than `\b` keeps a leading minus out of it: "-" to "1" IS a
  // word boundary, so "-1000" groups as "-1,000" and not "-,1000".
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
};

/**
 * The inverse of `moneyFormatter`.
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
) => (displayValue ?? "").replace(/,/g, "") as unknown as number;
