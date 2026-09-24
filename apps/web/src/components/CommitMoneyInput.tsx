/**
 * A whole-rupiah box for a table cell, written when it is left or Enter is
 * pressed — never per keystroke.
 *
 * Lifted out of the Inbound order page (2026-09-19), where every unit's price
 * is typed this way, so that the *Inbound* section's price boxes are the same
 * box as the ones in the list of units rather than a copy of it. Writing per
 * keystroke would re-render the row under the caret; the order page's
 * docblock on its serial drafts tells that story.
 *
 * `Rp` sits inside, as a prefix: a cell has no room for the addon that
 * `MoneyInput` puts beside a form field.
 */
import { InputNumber } from "antd";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { isPriceInRange } from "../lib/unitPrice.js";

export interface CommitMoneyInputProps {
  readonly id: string;
  /** The box's accessible name — a cell has no visible label to lend it one. */
  readonly label: string;
  readonly value: number | null;
  readonly placeholder?: string;
  /** Amber: nothing typed yet where a figure is expected. */
  readonly warn?: boolean;
  readonly onChange: (v: number | null) => void;
  readonly onCommit: (v: number | null) => void;
}

export function CommitMoneyInput({
  id,
  label,
  value,
  placeholder,
  warn,
  onChange,
  onCommit,
}: CommitMoneyInputProps) {
  const bad = !isPriceInRange(value);
  return (
    <InputNumber<number>
      id={id}
      size="small"
      style={{ width: "100%" }}
      // No `min`/`max`: antd snaps rather than refusing, and a snapped price
      // is a number nobody chose. The commit refuses and says so.
      precision={0}
      prefix={RP_SYMBOL}
      formatter={moneyFormatter}
      parser={moneyParser}
      status={bad ? "error" : warn ? "warning" : undefined}
      aria-invalid={bad || undefined}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(v) => onChange(v)}
      onPressEnter={() => onCommit(value)}
      onBlur={() => onCommit(value)}
    />
  );
}
