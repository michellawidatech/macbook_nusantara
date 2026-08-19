import type { CSSProperties } from "react";
import { Form, InputNumber, Space } from "antd";
import { TWD_SYMBOL, moneyFormatter, moneyParser } from "./money";

export interface MoneyAddonProps {
  /** Greys the addon out with the input it is attached to. */
  disabled?: boolean;
}

/**
 * The "NT$" box that sits OUTSIDE the editable area.
 *
 * `Space.Compact` + `Space.Addon` rather than `InputNumber`'s `addonBefore`:
 * both addon props are deprecated in antd v6 and warn on every render, telling
 * you to use exactly this pair. It is not a workaround — `addonBefore` is
 * implemented by rendering these two components, so this is the same DOM
 * without the warning.
 *
 * The status is read from the surrounding `Form.Item` so the addon turns red
 * with the input on a failed rule, which is what antd's own addon path does
 * via the form context. `useStatus` reports 'validating' and 'success' too;
 * `Space.Addon` styles neither, so only the two that paint are passed on.
 *
 * ⚠️ Must be rendered INSIDE a `Form.Item`. `useStatus` warns in dev when it
 * is not, because outside one the context carries no status at all. A money
 * figure that is not a form field — a read-only total in a table, say — wants
 * `TWD.format` from `domain/stock.ts`, not this.
 */
export function MoneyAddon({ disabled }: MoneyAddonProps) {
  const { status } = Form.Item.useStatus();
  return (
    <Space.Addon
      // Matches `ThemeProvider`'s app-wide `variant="filled"`. `Space.Addon`
      // defaults to `outlined` and — unlike every antd control — does NOT read
      // the variant off ConfigProvider, so without this the addon draws a
      // hairline box beside a borderless field and the pair reads as two
      // controls rather than one. antd's own deprecated `addonBefore` has the
      // same gap; keep this in step with ThemeProvider if that value changes.
      variant="filled"
      disabled={disabled}
      status={status === "error" || status === "warning" ? status : undefined}
    >
      {TWD_SYMBOL}
    </Space.Addon>
  );
}

export interface MoneyInputProps {
  /** Bound by Form.Item — do not pass by hand. */
  value?: number;
  /** Bound by Form.Item — do not pass by hand. */
  onChange?: (value: number | null) => void;
  /** Bound by Form.Item — do not pass by hand. Focuses the input from its label. */
  id?: string;
  min?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Applied to the wrapper, not the input: the addon is part of the control. */
  style?: CSSProperties;
}

/**
 * A whole-dollar money field: thousands separators inside, "NT$" outside.
 *
 * The one place either of those is decided, together with `./money.ts`. The
 * fill-grid cells cannot use this component — `MultiFillNumber` wraps its own
 * `InputNumber` in the selection outline and the keyboard walk, and a second
 * component between `Form.Item` and that input would break the
 * `value`/`onChange` clone — so they import `MoneyAddon` and the
 * formatter/parser pair and assemble the same three pieces. Change the
 * currency or the grouping in those two files and both kinds of cell follow.
 *
 * `precision={0}` is not a prop: every `_twd` column in the schema is a bigint
 * of whole New Taiwan dollars (see `domain/stock.ts`), so there is no money
 * field in this app that takes cents.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  min = 0,
  disabled,
  placeholder,
  style,
}: MoneyInputProps) {
  return (
    <Space.Compact block style={style}>
      <MoneyAddon disabled={disabled} />
      <InputNumber<number>
        id={id}
        value={value}
        onChange={onChange}
        min={min}
        precision={0}
        formatter={moneyFormatter}
        parser={moneyParser}
        placeholder={placeholder}
        disabled={disabled}
        // The addon is sized by its text; the input takes what is left, which
        // is what makes this fill a table cell or a Col the way the plain
        // `width: 100%` it replaces used to.
        style={{ flex: 1 }}
      />
    </Space.Compact>
  );
}
