import type { ReactNode } from "react";
import { Flex, Select, Typography } from "antd";
import type { SelectProps } from "antd";
import { useTranslation } from "react-i18next";
import { useAutoSelectSingle } from "../hooks/useAutoSelectSingle";
import { SPACE } from "../theme/tokens";

interface EntityOption<T> {
  value: number;
  /** Flat text: what the built-in filter and a screen reader both read. */
  label: string;
  item: T;
}

export interface EntitySelectProps<T> {
  /** Bound by Form.Item — do not pass by hand. */
  value?: number;
  /** Bound by Form.Item — do not pass by hand. */
  onChange?: (value: number | undefined) => void;
  items: T[];
  loading?: boolean;
  getId: (item: T) => number;
  /** Flat text: what the built-in filter and a screen reader both read. */
  getLabel: (item: T) => string;
  /** The two-line dropdown row. Omit for a plain flat-label list. */
  renderOption?: (item: T) => ReactNode;
  /** The collapsed trigger, once something is picked. Omit to show the flat label. */
  renderLabel?: (item: T) => ReactNode;
  /** Entities already chosen elsewhere, so the same one cannot be picked twice. */
  excludeIds?: number[];
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  /** A "go create one" link, shown inside `notFoundContent` under the empty message. */
  emptyAction?: ReactNode;
  /**
   * Pick the only option when there is exactly one, instead of making the
   * operator open a dropdown to confirm a foregone conclusion. See
   * `useAutoSelectSingle` for the four rules it holds to.
   *
   * OPT-IN, and it must stay that way. Half of this component's callers are
   * filter toolbars (`OrderFilterFields`, `ProductFilterFields`,
   * `TestimonialFilterFields`, `MovementFilterFields`), where the empty value
   * means "all" — a filter that selected itself would silently hide rows the
   * operator never asked to hide. Only a WRITE form, where empty means
   * unanswered, should turn this on.
   */
  autoSelectSingle?: boolean;
}

/**
 * Picks one row out of a lookup table — `VariantSelect`'s shape,
 * generalised for every other "search a short list, pick one" field a list
 * or form screen needs (a category, a supplier, a location).
 *
 * `VariantSelect` is not rebuilt on top of this now: it works, two live
 * stock screens depend on it, and its SKU-specific two-line row and
 * mono-font SKU chip are not generic enough to be worth forcing through this
 * component's `renderOption`/`renderLabel` slots today.
 *
 * Three details are carried forward from `VariantSelect` VERBATIM, because
 * each one was a real bug before it was a convention:
 * - `filterOption` matches the flat `label`, never antd's default (which
 *   matches `value` — a numeric id nobody types).
 * - `listHeight={320}` — the default 256px shows barely three two-line rows.
 * - `popupMatchSelectWidth={340}` — the trigger is one narrow column; the
 *   dropdown is where the choosing happens and needs its own width.
 */
export function EntitySelect<T>({
  value,
  onChange,
  items,
  loading,
  getId,
  getLabel,
  renderOption,
  renderLabel,
  excludeIds = [],
  placeholder,
  allowClear = true,
  disabled,
  emptyAction,
  autoSelectSingle = false,
}: EntitySelectProps<T>) {
  const { t } = useTranslation();

  const options: EntityOption<T>[] = items
    .filter(
      (item) => getId(item) === value || !excludeIds.includes(getId(item)),
    )
    .map((item) => ({ value: getId(item), label: getLabel(item), item }));

  // Reads the OPTIONS, not `items`: what counts as "the only one" is what this
  // control would actually offer, after `excludeIds` has taken out whatever a
  // sibling row already claimed.
  useAutoSelectSingle({
    candidates: options.map((option) => option.value),
    value,
    onPick: (only) => onChange?.(only),
    // A list still arriving is not a list of one, and a disabled control must
    // not answer its own question while the operator cannot change it.
    enabled: autoSelectSingle && !loading && !disabled,
  });

  const filterOption: SelectProps["filterOption"] = (input, option) =>
    (option as EntityOption<T> | undefined)?.label
      .toLowerCase()
      .includes(input.trim().toLowerCase()) ?? false;

  const optionRender: SelectProps["optionRender"] | undefined = renderOption
    ? (option) => renderOption((option.data as EntityOption<T>).item)
    : undefined;

  const labelRender: SelectProps["labelRender"] | undefined = renderLabel
    ? ({ value: selected }) => {
        const item = items.find((entry) => getId(entry) === selected);
        return item ? renderLabel(item) : null;
      }
    : undefined;

  return (
    <Select<number, EntityOption<T>>
      value={value}
      onChange={(nextValue) => onChange?.(nextValue)}
      options={options}
      loading={loading}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder}
      filterOption={filterOption}
      optionRender={optionRender}
      labelRender={labelRender}
      listHeight={320}
      popupMatchSelectWidth={340}
      notFoundContent={
        <Flex
          vertical
          gap={SPACE.xs}
          align="center"
          style={{ padding: SPACE.sm }}
        >
          <Typography.Text type="secondary">
            {t("entitySelect.noMatch", "No matches")}
          </Typography.Text>
          {emptyAction}
        </Flex>
      }
      style={{ width: "100%" }}
    />
  );
}
