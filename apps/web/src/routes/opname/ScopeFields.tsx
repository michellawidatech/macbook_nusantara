/**
 * The four scope axes, as a form — shared by the start dialog and the
 * mid-count editor.
 *
 * ## Why it is a component and not two copies
 *
 * The scope grew a second editor on 2026-09-01 (owner ask: change what a count
 * covers while counting it). The axes are not four independent selects — racks
 * depend on the warehouses picked, narrowing the warehouses has to drop racks
 * that are no longer on offer, and every one of them means "all" when empty,
 * which is a rule the form can only state in prose under each field. Copied
 * into a second dialog, that is four `extra` sentences and one non-obvious
 * cascade waiting to drift.
 *
 * `lib/opnameScope.ts` owns what a scope MEANS. This owns what it looks like.
 */
import { useMemo } from "react";
import { Form, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { OpnameScope } from "../../lib/opnameScope.js";
import { CONDITIONS, type UnitCondition } from "../../lib/condition.js";
import { fmtNone } from "../../lib/format.js";
import type { CatalogModel, RackLocation, Warehouse } from "../../mock/seed.js";
import { warehouseLabel, warehouseLabelOf } from "../../lib/warehouses.js";

export interface ScopeFieldsProps {
  value: OpnameScope;
  onChange: (next: OpnameScope) => void;
  warehouses: readonly Warehouse[];
  racks: readonly RackLocation[];
  models: readonly CatalogModel[];
  /** Extra prose above the fields — the mid-count editor's warning. */
  children?: React.ReactNode;
}

/**
 * How a condition is spelled.
 *
 * Written at a call site rather than in `lib/condition.ts` for the reason
 * `CONDITIONS` gives: the i18n sweep reads call sites, so a label declared in a
 * module constant is a label the coverage test cannot see.
 */
export function useConditionWord(): (c: UnitCondition) => string {
  const { t } = useTranslation();
  return (c) =>
    c === "NEW"
      ? t("opnameScope.conditionNew", "New")
      : t("opnameScope.conditionSecond", "Second");
}

export function ScopeFields({
  value,
  onChange,
  warehouses,
  racks,
  models,
  children,
}: ScopeFieldsProps) {
  const { t } = useTranslation();
  const conditionWord = useConditionWord();

  /**
   * Racks belong to warehouses, so the rack list follows the warehouse choice.
   *
   * With no warehouse picked the count covers all of them, and so does this.
   */
  const rackOptions = useMemo(
    () =>
      racks
        .filter(
          (r) =>
            r.active &&
            (value.locationIds.length === 0 ||
              value.locationIds.includes(r.warehouseId)),
        )
        .map((r) => ({
          value: r.id,
          label:
            value.locationIds.length === 1
              ? r.name
              : // Qualified only when the qualifier tells two racks apart —
                // every warehouse numbers its own from one, so a bare "Rak 1"
                // is ambiguous the moment two warehouses are in play.
                `${warehouseLabelOf(warehouses, r.warehouseId) ?? fmtNone()} · ${r.name}`,
        })),
    [racks, warehouses, value.locationIds],
  );

  /** Distinct categories, from the catalogue — the mock has no category table. */
  const categoryOptions = useMemo(
    () =>
      [...new Set(models.map((m) => m.category))]
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c })),
    [models],
  );

  /**
   * Narrowing the warehouses drops any rack that is no longer on offer.
   *
   * Left alone, a rack picked from Gudang Utama would stay in the scope after
   * the warehouse was switched to Gudang Cabang — an invisible axis matching
   * nothing, and a count that expects zero machines for no visible reason.
   */
  const pickWarehouses = (next: string[]) => {
    onChange({
      ...value,
      locationIds: next,
      rackIds: value.rackIds.filter((id) => {
        const rack = racks.find((r) => r.id === id);
        return (
          rack !== undefined &&
          (next.length === 0 || next.includes(rack.warehouseId))
        );
      }),
    });
  };

  return (
    <>
      {children}
      {/*
       * None of them is required, and the `extra` under each says what leaving
       * it alone means — because "unpicked = all" is a rule a form cannot show
       * by itself, and getting it backwards is the difference between counting
       * one rack and declaring the warehouse lost. `allowClear` so the way
       * back to "all" is one click.
       */}
      <Form.Item
        label={t("opnameScope.warehouses", "Warehouses")}
        extra={t(
          "opnameScope.warehousesHint",
          "Leave empty to count every warehouse.",
        )}
      >
        <Select
          mode="multiple"
          allowClear
          value={value.locationIds as string[]}
          onChange={pickWarehouses}
          placeholder={t("opnameScope.allWarehouses", "All warehouses")}
          options={warehouses
            .filter((w) => w.active)
            .map((w) => ({ value: w.id, label: warehouseLabel(w) }))}
        />
      </Form.Item>
      <Form.Item
        label={t("opnameScope.racks", "Racks")}
        extra={t(
          "opnameScope.racksHint",
          "Leave empty for every rack in those warehouses. Naming racks leaves out units still in QC, which are not on a shelf yet.",
        )}
      >
        <Select
          mode="multiple"
          allowClear
          value={value.rackIds as string[]}
          onChange={(rackIds: string[]) => onChange({ ...value, rackIds })}
          placeholder={t("opnameScope.allRacks", "All racks")}
          options={rackOptions}
        />
      </Form.Item>
      <Form.Item
        label={t("opnameScope.categories", "Product categories")}
        extra={t(
          "opnameScope.categoriesHint",
          "Leave empty to count every category.",
        )}
      >
        <Select
          mode="multiple"
          allowClear
          value={value.categories as string[]}
          onChange={(categories: string[]) =>
            onChange({ ...value, categories })
          }
          placeholder={t("opnameScope.allCategories", "All categories")}
          options={categoryOptions}
        />
      </Form.Item>
      <Form.Item
        label={t("opnameScope.condition", "Condition")}
        extra={t(
          "opnameScope.conditionHint",
          "Leave empty to count both new and second-hand.",
        )}
      >
        <Select
          mode="multiple"
          allowClear
          value={value.conditions as UnitCondition[]}
          onChange={(conditions: UnitCondition[]) =>
            onChange({ ...value, conditions })
          }
          placeholder={t("opnameScope.allConditions", "New and second")}
          options={CONDITIONS.map((c) => ({
            value: c,
            label: conditionWord(c),
          }))}
        />
      </Form.Item>
    </>
  );
}

/** One axis of a scope as a sentence — used by both dialogs' summaries. */
export function ScopeHint({ scope }: { scope: OpnameScope }) {
  const { t } = useTranslation();
  return (
    <Typography.Text type="secondary">
      {scope.locationIds.length === 0 &&
      scope.rackIds.length === 0 &&
      scope.categories.length === 0 &&
      scope.conditions.length === 0
        ? t("opnameScope.wholeShop", "Every unit the shop holds.")
        : t(
            "opnameScope.narrowed",
            "Only units matching every axis you picked.",
          )}
    </Typography.Text>
  );
}
