/**
 * The two price boxes a machine carries: what the counter asks, and what a
 * marketplace listing asks (owner ask 2026-09-08).
 *
 * A sibling of `BatteryFields`, and for the same reason: two desks ask for a
 * price now — Inbound & QC, where the price is decided, and the Inventory
 * price grid, where a shelf is repriced — and neither of them should have to
 * know that the marketplace figure is derived-until-overridden.
 *
 * ## Empty is not zero, in either box
 *
 * An empty store box is "nobody has priced this", which is the state a machine
 * is in until QC decides. An empty marketplace box is "follow the rule", and
 * it shows the derived figure as its placeholder so the row never looks
 * unpriced. Zero in either is a giveaway somebody chose — see
 * `lib/unitPrice.ts`.
 *
 * ## Each box says which it is (owner report 2026-09-09)
 *
 * > *"In setting price, we should not stack the store and marketplace field
 * > without specifying which is which."*
 *
 * The two carried an `aria-label` and nothing a sighted person could read, so
 * on screen they were one Rp box above another identical Rp box — and the
 * order of the two was the only thing distinguishing them. That is a fact you
 * have to be told once and then remember, at a bench where somebody is
 * pricing eleven machines in a row, and the cost of misremembering it is a
 * marketplace listing at the counter price.
 *
 * A caption above each box rather than a `prefix` inside it: the prefix is
 * already `Rp`, and both boxes need one — swapping the currency for the name
 * would leave two boxes that say what they are and not what units they are
 * in. `BatteryFields` puts its unit in a `suffix` for the same reason in
 * reverse: there the NAME is the column heading and the unit is what differs.
 */
import { Flex, InputNumber, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import {
  derivedMarketPrice,
  isPriceInRange,
  PRICE_MAX,
  PRICE_MIN,
} from "../lib/unitPrice.js";
import { SPACE, TYPE } from "../theme/tokens";

/** What the two boxes hold. `null` is a box somebody emptied. */
export interface PriceDraft {
  readonly price?: number | null;
  readonly marketPrice?: number | null;
}

export interface PriceFieldsProps {
  readonly value: PriceDraft;
  readonly onChange: (next: PriceDraft) => void;
  readonly onCommit?: (field: keyof PriceDraft, value: number | null) => void;
  readonly markupPct: number;
  readonly disabled?: boolean;
  readonly size?: "small" | "middle";
  readonly idPrefix: string;
}

export function PriceFields({
  value,
  onChange,
  onCommit,
  markupPct,
  disabled,
  size = "small",
  idPrefix,
}: PriceFieldsProps) {
  const { t } = useTranslation();
  const derived = derivedMarketPrice(value.price ?? 0, markupPct);

  const box = (
    field: keyof PriceDraft,
    label: string,
    hint?: string,
    placeholder?: string,
  ) => {
    const shown = value[field] ?? null;
    const bad = !isPriceInRange(shown);
    const id = `${idPrefix}-${field}`;
    return (
      <Flex vertical gap={2} key={field} style={{ minWidth: 0 }}>
        {/*
         * A real `<label>`, not a caption that happens to sit above the box.
         * The control keeps its `aria-label` — antd's InputNumber renders a
         * wrapper around the input, so `htmlFor` alone is not a guarantee that
         * a screen reader names the right element — and this is what the
         * SIGHTED reader gets, which is the half that was missing.
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
          // No `min`/`max`: antd snaps rather than refusing, and a snapped
          // price is a number nobody chose. See `BatteryFields` for the whole
          // argument.
          aria-valuemin={PRICE_MIN}
          aria-valuemax={PRICE_MAX}
          precision={0}
          prefix={RP_SYMBOL}
          placeholder={placeholder}
          formatter={moneyFormatter}
          parser={moneyParser}
          status={bad ? "error" : undefined}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-range` : undefined}
          aria-label={label}
          value={shown}
          onChange={(v) => onChange({ ...value, [field]: v })}
          onPressEnter={() => onCommit?.(field, shown)}
          onBlur={() => onCommit?.(field, shown)}
        />
        {bad ? (
          <Typography.Text
            id={`${id}-range`}
            type="danger"
            style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
          >
            {t("price.notAPrice", "Not a price")}
          </Typography.Text>
        ) : (
          hint && (
            // Under the box it is about, not under the pair. It used to sit at
            // the bottom of the stack, where "follows the rule" read as a
            // remark about both prices — and the one it is never about is the
            // store price, which is the box directly above it.
            <Typography.Text
              type="secondary"
              style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
            >
              {hint}
            </Typography.Text>
          )
        )}
      </Flex>
    );
  };

  return (
    <Flex vertical gap={SPACE.sm}>
      {box("price", t("price.store", "Store price"))}
      {box(
        "marketPrice",
        t("price.market", "Marketplace price"),
        value.marketPrice == null
          ? t("price.followsRule", "follows the rule")
          : undefined,
        fmtRp(derived),
      )}
    </Flex>
  );
}
