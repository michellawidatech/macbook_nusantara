import type { CSSProperties, ReactNode } from "react";
import { InputNumber } from "antd";

/**
 * The class that holds a whole-number field open.
 *
 * On the element rather than in a `style`, because the rule it carries is a
 * `min-width` expressed in `ch` — the width of a "0" in the field's OWN font —
 * and that has to survive the 16px bump `global.css` puts on every input below
 * `md` to stop iOS zooming the viewport. A pixel figure computed here would be
 * measured against the 14px desktop font and come up four pixels short on the
 * one screen where the problem was reported. See `global.css`.
 */
export const COUNT_INPUT_CLASS = "nusantara-count-input";

/**
 * The width a column holding one of these has to leave it.
 *
 * The class below is the guarantee; this is the number a `<Table>` column uses
 * so the grid asks for the room in the first place rather than discovering it
 * mid-layout. Cell padding (8px each side at `size="small"`) is included,
 * which is why it is larger than the input's own floor.
 */
export const COUNT_COLUMN_WIDTH = 108;

export interface CountInputProps {
  /** Bound by Form.Item — do not pass by hand. */
  value?: number | null;
  /** Bound by Form.Item — do not pass by hand. */
  onChange?: (value: number | null) => void;
  /** Bound by Form.Item — do not pass by hand. */
  id?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  placeholder?: string;
  size?: "small" | "middle" | "large";
  status?: "error" | "warning";
  /** Inside the box, after the number — "%" on a battery reading. */
  suffix?: ReactNode;
  style?: CSSProperties;
  className?: string;
  /**
   * Required, and that is the point.
   *
   * These live in table cells, where the only thing naming the field is a
   * column header three rows up that no screen reader will ever connect to
   * it. Making the prop non-optional is the one way to stop the next numeric
   * column shipping anonymous, which is how every one of them shipped before.
   */
  "aria-label": string;
  /** The bounds, for assistive tech, where `min`/`max` are deliberately unset. */
  "aria-valuemin"?: number;
  "aria-valuemax"?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A whole-number field that is always wide enough to be typed into.
 *
 * The owner's complaint (2026-09-01) was about Qty on the inbound order form:
 * squeeze the window and the column collapses until the box holds about one
 * character, with the stepper arrows sitting on top of it. That was three
 * faults stacked — a `<Input type="number">` with the browser's own spinners, a
 * column with a `width` hint and no `scroll.x` to honour it, and no floor under
 * the input itself — and this component is the third of them, kept apart from
 * the other two because it is the only one a caller can get wrong silently.
 *
 * Three digits is the floor the owner named, and it is the right one: a Qty
 * over 999 does not happen in a shop that counts second-hand Macs, and a
 * battery health reading maxes out at 100. Both fit, with the arrows clear of
 * the number rather than over it.
 *
 * `MoneyInput` is the money equivalent and is NOT this — a rupiah figure is
 * seven digits with grouping and wants an "Rp" outside the box.
 */
export function CountInput({
  className,
  ...rest
}: CountInputProps) {
  return (
    <InputNumber<number>
      {...rest}
      // `value` is `number | null` here and antd wants `number | undefined`;
      // the two mean the same thing to a stepper, and null is what a cleared
      // box hands back.
      value={rest.value ?? undefined}
      className={className ? `${COUNT_INPUT_CLASS} ${className}` : COUNT_INPUT_CLASS}
    />
  );
}
