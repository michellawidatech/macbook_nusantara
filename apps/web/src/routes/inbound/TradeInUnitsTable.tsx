/**
 * Inbound → Trade-in: every unit the shop took in against a sale (owner ask
 * 2026-10-31: *"in inbound step I guess you can add a 'Trade-in' tab so that
 * they can see the units that are from trade-ins"*).
 *
 * A trade-in is not a purchase order — it is bought across the counter on a
 * sale, or from a customer with no sale ("+ Trade-in", a BP document), and
 * its QC is taken in the trade-in dialog — so it is on no invoice and never
 * in Waiting for QC. This is where it can still be found as intake: one
 * row per unit, with the columns Inbound's unit popup asks (serial, grade,
 * battery, description, never serviced, sell price) beside what the shop paid
 * and the sale it came in on. Read-only: the unit is corrected where units
 * are, from its serial.
 */
import { useMemo } from "react";
import { Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { GradeTag } from "../../components/GradeTag";
import { ProTable } from "../../components/ProTable";
import { SerialLink } from "../../components/SerialLink";
import { readUnitBattery } from "../../lib/battery.js";
import { customerLabel } from "../../lib/customers.js";
import { fmtDate, fmtNone, fmtRp } from "../../lib/format.js";
import { tagOf, UNIT_STATUS } from "../../i18n/enumLabels.js";
import type { MockDb } from "../../mock/seed.js";
import { COLUMN } from "../../theme/tokens";

export interface TradeInUnitRow {
  readonly key: string;
  readonly at: string;
  readonly orderCode: string;
  readonly customer: string;
  readonly product: string;
  readonly skuCode: string;
  /** Empty for a counted product, which has no serial. */
  readonly serial: string;
  readonly grade?: string;
  readonly battery: string;
  readonly description: string;
  readonly neverServiced?: boolean;
  /** What the shop paid for it. */
  readonly bought: number;
  readonly sellPrice?: number;
  readonly status?: string;
}

/** One row per unit any sale took in. Newest first. */
export function tradeInUnitRows(db: MockDb): TradeInUnitRow[] {
  const out: TradeInUnitRow[] = [];
  for (const o of db.orders) {
    const c = db.customers.find((x) => x.id === o.customerId);
    for (const x of o.tradeIns ?? []) {
      const serial = (x.serial ?? "").trim().toUpperCase();
      const unit =
        serial === "" ? undefined : db.units.find((u) => u.serial === serial);
      const sku = db.skus.find((s) => s.id === (unit?.skuId ?? x.skuId));
      out.push({
        key: `${o.id}:${x.id}`,
        at: o.ts,
        orderCode: o.code,
        customer: c ? customerLabel(c) : "",
        product: sku ? `${sku.name} ${sku.variantLabel}`.trim() : x.label,
        skuCode: sku?.code ?? "",
        serial,
        grade: unit?.grade ?? x.grade,
        battery: unit ? readUnitBattery(unit, db).text : "",
        description: unit?.description ?? "",
        neverServiced: unit?.neverServiced,
        bought: x.value,
        sellPrice: unit?.price,
        status: unit?.status,
      });
    }
  }
  // Bought from a customer with no sale (2026-10-31): the BP document.
  for (const p of db.customerPurchases) {
    const c = db.customers.find((x) => x.id === p.customerId);
    for (const x of p.items) {
      const unit = x.serial
        ? db.units.find((u) => u.serial === x.serial)
        : undefined;
      const sku = db.skus.find((s) => s.id === x.skuId);
      out.push({
        key: `${p.id}:${x.id}`,
        at: p.at,
        orderCode: p.code,
        customer: c ? customerLabel(c) : "",
        product: sku ? `${sku.name} ${sku.variantLabel}`.trim() : x.label,
        skuCode: sku?.code ?? "",
        serial: x.serial ?? "",
        grade: unit?.grade,
        battery: unit ? readUnitBattery(unit, db).text : "",
        description: unit?.description ?? "",
        neverServiced: unit?.neverServiced,
        bought: x.value,
        sellPrice: unit?.price,
        status: unit?.status,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function TradeInUnitsTable({ db }: { readonly db: MockDb }) {
  const { t } = useTranslation();
  const rows = useMemo(() => tradeInUnitRows(db), [db]);

  return (
    <ProTable<TradeInUnitRow>
      persistKey="inbound.tradeIns"
      rowKey="key"
      dataSource={rows}
      searchPlaceholder={t(
        "tradeInList.search",
        "Search product, serial, transaction or customer",
      )}
      columns={[
        {
          title: t("tradeInList.date", "Date"),
          dataIndex: "at",
          width: COLUMN.date,
          dateRange: true,
          sortValue: (r) => r.at,
          defaultSortOrder: "descend",
          render: (_: unknown, r) => fmtDate(r.at),
        },
        {
          title: t("tradeInList.transaction", "Transaction"),
          dataIndex: "orderCode",
          width: COLUMN.code,
          searchable: true,
          searchValue: (r) => `${r.orderCode} ${r.customer}`,
          render: (_: unknown, r) => (
            <>
              <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                {r.orderCode}
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: 12 }}
              >
                {r.customer || t("tradeInList.walkIn", "Walk-in")}
              </Typography.Text>
            </>
          ),
        },
        {
          title: t("tradeInList.product", "Product"),
          dataIndex: "product",
          searchable: true,
          facet: true,
          searchValue: (r) => `${r.product} ${r.skuCode}`,
          render: (_: unknown, r) => r.product || fmtNone(),
        },
        {
          title: t("inbound.serial", "Serial"),
          dataIndex: "serial",
          width: COLUMN.serial,
          searchable: true,
          render: (_: unknown, r) =>
            r.serial === "" ? fmtNone() : <SerialLink serial={r.serial} />,
        },
        {
          title: t("inbound.grade", "Grade"),
          dataIndex: "grade",
          width: COLUMN.grade,
          render: (_: unknown, r) =>
            r.grade ? <GradeTag grade={r.grade} /> : fmtNone(),
        },
        {
          title: t("inbound.battery", "Battery Health"),
          dataIndex: "battery",
          width: COLUMN.status,
          render: (_: unknown, r) => r.battery || fmtNone(),
        },
        {
          title: t("inbound.description", "Description"),
          dataIndex: "description",
          render: (_: unknown, r) => r.description || fmtNone(),
        },
        {
          title: t("qc.neverServiced", "Never serviced / opened"),
          dataIndex: "neverServiced",
          width: COLUMN.status,
          render: (_: unknown, r) =>
            r.neverServiced === true
              ? t("qc.neverServicedYes", "Never")
              : r.neverServiced === false
                ? t("qc.neverServicedNo", "Serviced")
                : t("qc.neverServicedUnknown", "Not checked"),
        },
        {
          title: t("tradeInList.bought", "Bought for"),
          dataIndex: "bought",
          width: COLUMN.money,
          align: "right",
          sortValue: (r) => r.bought,
          render: (_: unknown, r) => fmtRp(r.bought),
        },
        {
          title: t("inbound.sellPrice", "Sell price"),
          dataIndex: "sellPrice",
          width: COLUMN.money,
          align: "right",
          render: (_: unknown, r) => fmtRp(r.sellPrice ?? 0),
        },
        {
          title: t("tradeInList.status", "Status"),
          dataIndex: "status",
          width: COLUMN.status,
          facet: true,
          facetValue: (r) =>
            r.status ? tagOf(UNIT_STATUS, r.status, t).label : fmtNone(),
          render: (_: unknown, r) => {
            if (!r.status) return fmtNone();
            const tag = tagOf(UNIT_STATUS, r.status, t);
            return <Tag color={tag.color}>{tag.label}</Tag>;
          },
        },
      ]}
    />
  );
}
