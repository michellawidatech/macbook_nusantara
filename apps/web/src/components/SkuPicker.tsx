/**
 * Choosing a product in a line-item cell, in a column that does not move.
 *
 * The owner's complaint of 2026-09-01, with the screenshot: a picker holding
 * `PRO 13" 2016 i5 8/128 NTB — MacBook Pro 13 2016 i5 / 8GB / 128GB / NTB`
 * asked its column for the whole seventy characters on one line, and got them
 * out of its neighbours' pockets — Qty came out narrower than its own stepper
 * arrows, and `Rp 3.900.000` broke across three lines in the Total column.
 * "It is supposed to have fixed width and continue below it instead… it should
 * just have 2 rows."
 *
 * `EditableTable` holds the column (see `declaredWidth` and the `fixed` table
 * layout). This is the other half: the label stops being one long line.
 *
 * ⚠️ It CANNOT be done by wrapping the text. antd 6 rebuilt Select — the chosen
 * value is the value of a real `<input class="ant-select-input">`, not a
 * `<span>` — and an input renders one line whatever CSS asks of it. So the
 * label is split at the place it was always two things:
 *
 * - the **code** goes in the box. `PRO 13" 2016 i5 8/128 NTB` is what the shop
 *   prints on the sticker and reads off the shelf, it is unique per variant,
 *   and it fits.
 * - the **name and variant** go on a line under the box, as ordinary text,
 *   which wraps over as many lines as the column gives it.
 *
 * Nothing is hidden by the split — it is the same string, on two lines, in a
 * cell that no longer bids for width. Both halves are still searchable, so
 * typing either the code or "MacBook Pro 13" finds the row, and the dropdown
 * shows both the way `InventoryPage`'s serial picker already does.
 */
import { Flex, Select, Typography } from "antd";
import { TYPE } from "../theme/tokens";
import { useTranslation } from "react-i18next";

/** What this picker needs to know about a variant. */
export interface PickableSku {
  id: string;
  /** The printed product code — `PRO 13" 2016 i5 8/128 NTB`. */
  code: string;
  name: string;
  variantLabel: string;
}

/** The half that goes under the box: the model and what is in it. */
export function skuFullName(sku: Pick<PickableSku, "name" | "variantLabel">) {
  return `${sku.name} ${sku.variantLabel}`.trim();
}

export interface SkuPickerProps {
  skus: readonly PickableSku[];
  value?: string;
  onChange: (skuId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Paints the box amber while the line has no product on it. */
  status?: "warning" | "error";
  /** Names the box, where the column header cannot. Required — see `CountInput`. */
  "aria-label": string;
  /** What a `Form.Item` hands its control, so its label points at the box. */
  id?: string;
}

export function SkuPicker({
  skus,
  value,
  onChange,
  disabled,
  placeholder,
  status,
  "aria-label": ariaLabel,
  id,
}: SkuPickerProps) {
  const { t } = useTranslation();
  const chosen = skus.find((s) => s.id === value);

  return (
    <Flex vertical gap={2}>
      <Select
        showSearch
        // The code, and only the code. antd 6 paints `label` into the box and
        // has dropped `optionLabelProp`, which was the usual way to show one
        // thing in the list and another in the field — so the list is
        // decorated through `optionRender` instead and the filter is widened
        // to cover what the label no longer says.
        optionFilterProp="value"
        filterOption={(input, opt) => {
          const sku = skus.find((s) => s.id === opt?.value);
          if (!sku) return false;
          const hay = `${sku.code} ${skuFullName(sku)}`.toLowerCase();
          return hay.includes(input.toLowerCase());
        }}
        style={{ width: "100%" }}
        disabled={disabled}
        value={value || undefined}
        onChange={onChange}
        status={status}
        aria-label={ariaLabel}
        {...(id === undefined ? {} : { id })}
        placeholder={
          placeholder ?? t("skuPicker.pick", "Search a code or a model name")
        }
        options={skus.map((s) => ({ value: s.id, label: s.code }))}
        optionRender={(opt) => {
          const sku = skus.find((s) => s.id === opt.value);
          return (
            <Flex vertical>
              <span>{sku?.code}</span>
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {sku ? skuFullName(sku) : ""}
              </Typography.Text>
            </Flex>
          );
        }}
      />
      {chosen && (
        // The rest of the label, on its own line and free to take a second
        // one. Not a Tooltip: the name is what somebody checks a delivery
        // against, and a fact you have to hover to see is a fact nobody reads.
        <Typography.Text
          type="secondary"
          style={{ fontSize: TYPE.sm, lineHeight: 1.35 }}
        >
          {skuFullName(chosen)}
        </Typography.Text>
      )}
    </Flex>
  );
}
