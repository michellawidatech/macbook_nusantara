/**
 * The price box a unit carries: what the counter asks for it (owner ask
 * 2026-09-08).
 *
 * A sibling of `BatteryFields`, for the desk that decides a unit's price and
 * should not have to know that an empty box and a zero are different facts.
 *
 * ## One box since 2026-09-19
 *
 * It was two: the store price, and a marketplace price derived from it and
 * overridable per unit. *"Marketplace price is taken from the highest price
 * for all unit, so it will not be displayed per unit"* — the listing is the
 * variant's now (`variantMarketPrice` in `lib/unitPrice.ts`), so there is no
 * per-unit marketplace figure left to type, and the box went.
 *
 * ## Empty is not zero
 *
 * An empty box is "nobody has priced this", which is the state a unit is in
 * until QC decides. Zero is a giveaway somebody chose — see
 * `lib/unitPrice.ts`.
 *
 * ## The box says what it is (owner report 2026-09-09)
 *
 * A caption above it rather than a `prefix` inside it: the prefix is already
 * `Rp`, and swapping the currency for the name would leave a box that says
 * what it is and not what units it is in.
 */
import { Flex, InputNumber, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { isPriceInRange, PRICE_MAX, PRICE_MIN } from "../lib/unitPrice.js";
import { TYPE } from "../theme/tokens";

/** What the box holds. `null` is a box somebody emptied. */
export interface PriceDraft {
  readonly price?: number | null;
}

export interface PriceFieldsProps {
  readonly value: PriceDraft;
  readonly onChange: (next: PriceDraft) => void;
  readonly onCommit?: (field: keyof PriceDraft, value: number | null) => void;
  /** The variant's asking price, shown while the box is empty. */
  readonly placeholder?: number;
  readonly disabled?: boolean;
  readonly size?: "small" | "middle";
  readonly idPrefix: string;
}

export function PriceFields({
  value,
  onChange,
  onCommit,
  placeholder,
  disabled,
  size = "small",
  idPrefix,
}: PriceFieldsProps) {
  const { t } = useTranslation();
  const shown = value.price ?? null;
  const bad = !isPriceInRange(shown);
  const id = `${idPrefix}-price`;
  const label = t("price.store", "Store price");
  return (
    <Flex vertical gap={2} style={{ minWidth: 0 }}>
      {/*
       * A real `<label>`, not a caption that happens to sit above the box.
       * The control keeps its `aria-label` — antd's InputNumber renders a
       * wrapper around the input, so `htmlFor` alone is not a guarantee that a
       * screen reader names the right element.
       */}
      <label htmlFor={id}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
        >
          {label}
        </Typography.Text>
      </label>
      <InputNumber
        id={id}
        size={size}
        style={{ width: "100%" }}
        disabled={disabled}
        // No `min`/`max`: antd snaps rather than refusing, and a snapped price
        // is a number nobody chose. See `BatteryFields` for the whole argument.
        aria-valuemin={PRICE_MIN}
        aria-valuemax={PRICE_MAX}
        precision={0}
        prefix={RP_SYMBOL}
        // Grouped the way the box itself groups; the `Rp` is the prefix's.
        placeholder={
          placeholder === undefined
            ? undefined
            : Math.round(placeholder).toLocaleString("id-ID")
        }
        formatter={moneyFormatter}
        parser={moneyParser}
        status={bad ? "error" : undefined}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-range` : undefined}
        aria-label={label}
        value={shown}
        onChange={(v) => onChange({ ...value, price: v })}
        onPressEnter={() => onCommit?.("price", shown)}
        onBlur={() => onCommit?.("price", shown)}
      />
      {bad && (
        <Typography.Text
          id={`${id}-range`}
          type="danger"
          style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
        >
          {t("price.notAPrice", "Not a price")}
        </Typography.Text>
      )}
    </Flex>
  );
}
