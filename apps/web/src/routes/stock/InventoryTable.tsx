/**
 * What the shop holds, in one table: a row per product, expanding to the
 * serials behind it.
 *
 * ## Why one table and not two screens
 *
 * Until 2026-08-26 this was two nav items. "Inventory" answered "do you have a
 * MacBook Air M2 16/512, and how many?" — a question about a SKU — and "Stock
 * Movement" answered "which serials, and where are they?" Both are the same
 * stock counted at two altitudes, and keeping them apart meant a staff member
 * who started from the product had to change screens to reach the serial they
 * were actually going to touch.
 *
 * The owner asked for one table. An expandable row is what makes that
 * possible without losing either altitude: the row is the product with its
 * quantities, and opening it lists its serials with their status, location,
 * price and the Adjust button. Nothing is summarised away, and nothing needs a
 * second screen.
 *
 * The previous design put the serials in a Drawer, chosen because `DataTable`
 * draws cards instead of a grid on a phone and antd's expand control lives in
 * the grid. That is still true, and it is why this table passes
 * `cards={false}`: on a phone it stays a grid and scrolls sideways, which
 * keeps the expansion — the whole point of the merge — working on the device
 * most likely to be standing in the warehouse.
 *
 * ## Two levels of filtering, and the split matters before editing this file
 *
 * - **Above the table (warehouse, battery health)** filters UNITS, before the
 *   roll-up. This is what makes the quantities honest: with a poor-battery
 *   filter on, "3 available" means three units in that band, not a product
 *   that owns one. See `rollUpInventory` — the helper counts, the page decides
 *   what it counts.
 * - **The column header filters (category, product)** filter ROWS, after it.
 *   They narrow which products you are looking at without touching a quantity.
 *
 * `Scope` is the third control and the least obvious: a product with nothing in
 * stock is still an answer — "not right now" — so the roll-up keeps zero rows
 * and this hides them by default rather than dropping them upstream.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Flex,
  Segmented,
  Select,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from "antd";
import {
  EditOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { ProTable } from "../../components/ProTable";
import { EnumTag } from "../../components/EnumTag";
import { LongText } from "../../components/LongText";
import { GradeTag } from "../../components/GradeTag";
import { PrintLabelsModal } from "../../components/LabelSheet";
import { labelsFor } from "../../lib/labels.js";
import type { LabelDatum } from "../../lib/labels.js";
import { fmtRp } from "../../lib/format.js";
import {
  BATTERY_UNKNOWN,
  batteryBand,
  batteryBands,
  batteryGrade,
  BATTERY_GRADE_COLOR,
  batteryGuide,
  fmtBatteryHealth,
  thresholdsFrom,
} from "../../lib/battery.js";
import { rollUpInventory, type InventoryRow } from "../../lib/inventory.js";
import { useDb } from "../../mock/store.js";
import { UNIT_STATUS } from "../../i18n/enumLabels.js";
import { SPACE, TYPE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";
import type { Unit } from "../../mock/seed.js";

/** A quantity cell: the number, or a muted zero that does not shout. */
function Qty({ n, strong }: { n: number; strong?: boolean }) {
  if (n === 0) {
    return <Typography.Text type="secondary">0</Typography.Text>;
  }
  return <Typography.Text strong={strong}>{n}</Typography.Text>;
}

export interface InventoryTableProps {
  /**
   * Opens the single-unit adjustment editor for a serial. Supplied by the page,
   * which owns that modal along with the batch one — see `InventoryPage`.
   */
  onAdjust: (unit: Unit) => void;
  /** The page's own primary actions, rendered at the top right of the table. */
  extra?: React.ReactNode;
}

export function InventoryTable({ onAdjust, extra }: InventoryTableProps) {
  const db = useDb();

  /**
   * The origin code a unit's sticker carries — its purchase order's supplier.
   *
   * Two hops, and neither is something `lib/labels.ts` should know about, so
   * it is passed in. A unit with no order (a trade-in, a machine found at a
   * stock take) has no supplier and therefore no store barcode; its sticker
   * carries the bare serial, which still scans back to it.
   */
  const supplierCodeOf = (u: Unit): string | undefined => {
    const po = db.pos.find((p) => p.id === u.poId);
    return db.suppliers.find((x) => x.id === po?.supplierId)?.code;
  };
  const { t } = useTranslation();
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [scope, setScope] = useState<"STOCKED" | "ALL">("STOCKED");
  /** Null when the print dialog is closed; the sheet's contents when it is. */
  const [printing, setPrinting] = useState<LabelDatum[] | null>(null);
  const {
    token: { colorTextSecondary },
  } = theme.useToken();
  // The shop's thresholds, not the library defaults: Settings can move them.
  const thresholds = thresholdsFrom(db.settings);

  const warehouseName = (id: string) =>
    db.warehouses.find((w) => w.id === id)?.name ?? id;
  const rackName = (id?: string) => db.racks.find((r) => r.id === id)?.name;

  const units = useMemo(
    () =>
      db.units.filter(
        (u) =>
          (warehouseIds.length === 0 || warehouseIds.includes(u.locationId)) &&
          (bands.length === 0 ||
            bands.includes(batteryBand(u.batteryHealth, thresholds))),
      ),
    [db.units, warehouseIds, bands],
  );

  const all = useMemo(
    () => rollUpInventory(units, db.skus, db.models),
    [units, db.skus, db.models],
  );
  const rows = useMemo(
    () => (scope === "ALL" ? all : all.filter((r) => r.onHand > 0)),
    [all, scope],
  );

  const totalHeld = rows.reduce((t, r) => t + r.onHand, 0);
  const totalValue = rows.reduce((t, r) => t + r.value, 0);

  const filters = (
    <>
      <Select
        mode="multiple"
        allowClear
        maxTagCount="responsive"
        placeholder={t("inventory.anyWarehouse", "Any warehouse")}
        value={warehouseIds}
        onChange={setWarehouseIds}
        options={db.warehouses.map((w) => ({ value: w.id, label: w.name }))}
        style={{ minWidth: 200 }}
      />
      <Select
        mode="multiple"
        allowClear
        maxTagCount="responsive"
        placeholder={t("inventory.anyBattery", "Any battery health")}
        value={bands}
        onChange={setBands}
        options={[
          ...batteryBands(thresholds).map((b) => ({
            value: b.label,
            label: b.label,
          })),
          { value: BATTERY_UNKNOWN, label: BATTERY_UNKNOWN },
        ]}
        style={{ minWidth: 220 }}
      />
      <Segmented
        value={scope}
        onChange={(v) => setScope(v as "STOCKED" | "ALL")}
        options={[
          { value: "STOCKED", label: t("inventory.inStock", "In stock") },
          { value: "ALL", label: t("inventory.allProducts", "All products") },
        ]}
      />
    </>
  );

  /**
   * The serials behind one product row.
   *
   * A plain `<Table>`, not a `DataTable`: this is already inside a row of one,
   * and a nested pager would be a second set of page controls inside the first
   * one's page. A product with forty serials scrolls; that is the right cost
   * for the rarest row in the list.
   */
  const serialsOf = (row: InventoryRow) => (
    <Table<Unit>
      size="small"
      rowKey="serial"
      dataSource={row.units}
      pagination={false}
      // The expansion is the reason this whole component exists, so an empty
      // one has to say something rather than showing antd's bare "No data".
      locale={{
        emptyText: t(
          "inventory.noSerials",
          "None of this product is in stock right now.",
        ),
      }}
      columns={[
        {
          title: t("inventory.serial", "Serial"),
          dataIndex: "serial",
          render: (v: string) => (
            <Link to={`/stock/history?serial=${v}`}>{v}</Link>
          ),
        },
        {
          title: t("inventory.status", "Status"),
          dataIndex: "status",
          width: 130,
          render: (v: string) => <EnumTag map={UNIT_STATUS} value={v} />,
        },
        {
          // New or a letter — the owner's second ask of 2026-08-28. This is
          // the list a person scrolls looking for a machine to sell, and
          // "which of these four is the sealed one" was a question it could
          // not answer. `GradeTag` is the one place that decides how a grade
          // reads; see `lib/condition.ts` for what NEW means.
          title: t("inventory.grade", "Grade"),
          key: "grade",
          width: 90,
          render: (_: unknown, u: Unit) => <GradeTag grade={u.grade} />,
        },
        {
          title: t("inventory.battery", "Battery"),
          key: "battery",
          width: 100,
          align: "right",
          render: (_: unknown, u: Unit) => fmtBatteryHealth(u.batteryHealth),
        },
        {
          title: t("inventory.where", "Where"),
          key: "where",
          render: (_: unknown, u: Unit) =>
            [warehouseName(u.locationId), rackName(u.rackId)]
              .filter(Boolean)
              .join(" · "),
        },
        {
          // Two lines, not one (owner decision 2026-08-26). This is the column
          // staff write a sentence into; see `LongText`.
          title: t("inventory.description", "Description"),
          dataIndex: "description",
          width: 320,
          render: (v: string) => <LongText>{v}</LongText>,
        },
        {
          title: t("inventory.buy", "Buy"),
          key: "buy",
          width: 130,
          align: "right",
          render: (_: unknown, u: Unit) => fmtRp(u.buy),
        },
        {
          title: "",
          key: "actions",
          width: 60,
          render: (_: unknown, u: Unit) => (
            <Tooltip title={t("inventory.adjustUnit", "Adjust this unit")}>
              <Button
                type="text"
                aria-label={t("inventory.adjustAria", "Adjust {{serial}}", {
                  serial: u.serial,
                })}
                icon={<EditOutlined />}
                onClick={() => onAdjust(u)}
              />
            </Tooltip>
          ),
        },
      ]}
    />
  );

  return (
    <>
      <ProTable<InventoryRow>
        rowKey="skuId"
        dataSource={rows}
        // Grid on every viewport. antd's expand control lives in the grid, and
        // the expansion IS this table — see the docblock.
        cards={false}
        selectable
        // Printing a shelf's worth of stickers at once is the reason batch
        // selection exists here: a stock take that relabels three products
        // should be one trip to the printer, not three.
        bulkActions={(selected, clear) => (
          <Button
            icon={<PrinterOutlined />}
            onClick={() => {
              const picked = selected.flatMap((r) => r.units);
              setPrinting(labelsFor(picked, db.skus, db.models, supplierCodeOf));
              clear();
            }}
          >
            {t("inventory.printN", "Print labels ({{count}})", {
              count: selected.reduce((n, r) => n + r.units.length, 0),
            })}
          </Button>
        )}
        expandable={{
          expandedRowRender: serialsOf,
          // A product with nothing in stock has nothing to open. Leaving the
          // caret there would promise a drill-down that renders an empty box.
          rowExpandable: (r) => r.onHand > 0,
        }}
        // The pager goes back to page one when the question changes, not when
        // the store moves under it — DataTable's docblock on `resetKey`.
        resetKey={`${scope}|${warehouseIds.join()}|${bands.join()}`}
        searchPlaceholder={t(
          "inventory.searchPlaceholder",
          "Search product, specs, code or a serial number",
        )}
        toolbar={filters}
        extra={
          <Flex align="center" gap={SPACE.md} wrap>
            <Typography.Text type="secondary">
              {t(
                "inventory.summary",
                "{{products}} products · {{units}} units held · value {{value}}",
                {
                  products: rows.length,
                  units: totalHeld,
                  value: fmtRp(totalValue),
                },
              )}
            </Typography.Text>
            {extra}
          </Flex>
        }
        columns={[
          {
            title: t("inventory.product", "Product"),
            key: "product",
            width: 260,
            facet: true,
            facetLabel: t("inventory.anyProduct", "Any product"),
            searchable: true,
            sortValue: (r) => `${r.product} ${r.specs}`,
            // The filter lists models, not variants: eight rows of "MacBook
            // Air M2" differing only in RAM would make a filter nobody can
            // read.
            facetValue: (r) => r.product,
            // A serial is a legitimate way to reach a product row — staff
            // paste one in constantly — so the serials ride along in what
            // this column searches without being shown in it.
            searchValue: (r) =>
              `${r.product} ${r.specs} ${r.code} ${r.units
                .map((u) => u.serial)
                .join(" ")}`,
            render: (_, r) => (
              <>
                <Typography.Text strong>{r.product}</Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: TYPE.sm }}
                >
                  {r.specs}
                </Typography.Text>
              </>
            ),
          },
          {
            title: t("inventory.category", "Category"),
            dataIndex: "category",
            width: 130,
            facet: true,
            facetLabel: t("inventory.anyCategory", "Any category"),
          },
          {
            title: t("inventory.warehouse", "Warehouse"),
            key: "warehouses",
            width: 150,
            // Deliberately NOT faceted, for the same reason the battery column
            // is not: the warehouse select ABOVE the table is the honest
            // control, because it narrows UNITS and the quantities move with
            // it. A header filter here would narrow rows on the set of
            // warehouses a product sits in and leave "3 available" beside a
            // filter only one of the three is actually in.
            //
            // It also rendered as a literal duplicate — `DataTable` draws no
            // header on a phone, so `ProTable` falls back to toolbar selects
            // there, and the page showed "Any warehouse" twice in a row.
            sortValue: (r) => r.locationIds.map(warehouseName).join(", "),
            render: (_, r) =>
              r.locationIds.length === 0 ? (
                "—"
              ) : (
                <Flex gap={SPACE.xs} wrap>
                  {r.locationIds.map((id) => (
                    <Tag key={id}>{warehouseName(id)}</Tag>
                  ))}
                </Flex>
              ),
          },
          {
            /*
             * One quantity column, not two (owner decision 2026-08-26).
             *
             * `Available` and `Held` sat side by side and were the same number
             * on almost every row — a shop whose stock is nearly all sellable
             * shows two identical columns of digits, and the reader has to
             * work out which of the two they are being asked to read. The
             * total is the honest headline, so `Held`'s number stays and
             * `Available` becomes the first term of the breakdown under it,
             * beside the on-hold, QC and service counts it was always meant to
             * be read against.
             *
             * The breakdown is a line of text rather than four more columns:
             * on a normal day three of them are columns of zeros, and the
             * numeric columns they replace were pushing the price off the
             * right edge of a 1440px screen.
             */
            title: t("inventory.qty", "Qty"),
            key: "onHand",
            width: 190,
            align: "right",
            defaultSortOrder: "descend",
            sortValue: (r) => r.onHand,
            render: (_, r) => {
              const parts = [
                // Shown even when it is the whole quantity. A bare number over
                // nothing reads as "we hold 3"; "3 available" reads as "3 you
                // can sell today", which is the question being asked.
                r.available > 0 &&
                  t("inventory.nAvailable", "{{n}} available", {
                    n: r.available,
                  }),
                r.reserved > 0 &&
                  t("inventory.nOnHold", "{{n}} on hold", { n: r.reserved }),
                r.qc > 0 && t("inventory.nInQc", "{{n}} in QC", { n: r.qc }),
                r.service > 0 &&
                  t("inventory.nOnService", "{{n}} on service", {
                    n: r.service,
                  }),
              ].filter(Boolean);
              return (
                <Flex vertical align="flex-end" gap={2}>
                  <Qty n={r.onHand} strong />
                  {parts.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {parts.join(" · ")}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
          {
            // The `?` explains the bands and names the current thresholds,
            // which is the only honest way to label a column whose meaning
            // Settings can change underneath it.
            title: (
              <Flex align="center" gap={SPACE.xs}>
                {t("inventory.batteryHealth", "Battery health")}
                <Tooltip title={batteryGuide(thresholds)}>
                  <QuestionCircleOutlined
                    style={{ color: colorTextSecondary, cursor: "help" }}
                    aria-label={t(
                      "inventory.batteryBandsAria",
                      "What the battery bands mean",
                    )}
                  />
                </Tooltip>
              </Flex>
            ),
            key: "battery",
            width: 150,
            // Sorts on the lowest reading held — "show me the tiredest
            // batteries first" — and deliberately does NOT get a header
            // filter: the band select above the table is the honest one,
            // because it narrows UNITS and the quantities move with it. A
            // second one here would filter rows on the lowest reading of a
            // range and leave "3 available" beside a filter only one of the
            // three meets.
            sortValue: (r) => r.batteryMin,
            render: (_, r) => {
              if (r.batteryMin === undefined) return "—";
              const text =
                r.batteryMin === r.batteryMax
                  ? fmtBatteryHealth(r.batteryMin)
                  : `${fmtBatteryHealth(r.batteryMin)}–${fmtBatteryHealth(r.batteryMax)}`;
              // Coloured by the WORST reading in the range, not the best: a
              // product whose range spans a band boundary is one a buyer can
              // still be handed the tired unit from.
              const grade = batteryGrade(r.batteryMin, thresholds);
              return grade === null ? (
                text
              ) : (
                <Tag color={BATTERY_GRADE_COLOR[grade]}>{text}</Tag>
              );
            },
          },
          {
            // One number since 2026-08-27. This column used to carry a range
            // and a second line reconciling it against the list price, because
            // each serial was priced at QC and usually differed. The price is
            // the variant's now, so there is nothing left to reconcile — and a
            // "from" on a row where every unit costs the same would be a lie.
            title: t("inventory.price", "Price"),
            key: "price",
            width: 160,
            align: "right",
            sortValue: (r) => r.listPrice,
            render: (_, r) => (
              <Typography.Text>{fmtRp(r.listPrice)}</Typography.Text>
            ),
          },
          {
            title: "",
            key: "labels",
            width: 44,
            render: (_, r) => (
              <Tooltip
                title={
                  r.units.length === 0
                    ? t("inventory.noLabels", "No serials to label")
                    : t("inventory.printLabelsN", "Print {{count}} labels", {
                        count: r.units.length,
                      })
                }
              >
                {/* Per row as well as in the bulk bar: relabelling one product
                    is the common case, and making it cost a checkbox first is
                    a tick nobody wants to make. */}
                <Button
                  type="text"
                  icon={<PrinterOutlined />}
                  disabled={r.units.length === 0}
                  aria-label={t(
                    "inventory.printForAria",
                    "Print labels for {{product}}",
                    { product: r.product },
                  )}
                  onClick={() =>
                    setPrinting(labelsFor(r.units, db.skus, db.models, supplierCodeOf))
                  }
                />
              </Tooltip>
            ),
          },
        ]}
      />

      <PrintLabelsModal
        open={printing !== null}
        labels={printing ?? []}
        onClose={() => setPrinting(null)}
      />
    </>
  );
}
