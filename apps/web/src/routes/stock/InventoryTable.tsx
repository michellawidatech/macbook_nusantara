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
  App,
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
  TagsOutlined,
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
  BATTERY_BAND_LABEL,
  BATTERY_UNKNOWN,
  BATTERY_GRADE_COLOR,
  batteryBandOf,
  batteryEraGuide,
  batterySettingsFrom,
  batteryGrade,
  cycleGrade,
  fmtBatteryHealth,
  fmtCycleCount,
  fmtFcc,
  readUnitBattery,
} from "../../lib/battery.js";
import {
  gradeGroupsOf,
  rollUpInventory,
  type GradeGroup,
  type InventoryRow,
} from "../../lib/inventory.js";
import {
  DEFAULT_MARKETPLACE_MARKUP_PCT,
  isMarketPriceOverridden,
  marketPriceOf,
  priceOf,
  type PriceRange,
} from "../../lib/unitPrice.js";
import {
  PriceEditorModal,
  type PriceEdit,
} from "../../components/PriceEditorModal.js";
import { appendEvent, mutate, useDb } from "../../mock/store.js";
import { serviceCostOf } from "../../lib/service.js";
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
  const { message } = App.useApp();

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
  const batterySettings = batterySettingsFrom(db.settings);
  const markupPct =
    db.settings.marketplaceMarkupPct ?? DEFAULT_MARKETPLACE_MARKUP_PCT;
  const skuPriceOf = (skuId: string) =>
    db.skus.find((s) => s.id === skuId)?.price ?? 0;
  /** Null when the price grid is shut; what it is repricing when it is open. */
  const [repricing, setRepricing] = useState<{
    title: string;
    units: readonly Unit[];
  } | null>(null);

  const warehouseName = (id: string) =>
    db.warehouses.find((w) => w.id === id)?.name ?? id;
  const rackName = (id?: string) => db.racks.find((r) => r.id === id)?.name;

  const units = useMemo(
    () =>
      db.units.filter(
        (u) =>
          (warehouseIds.length === 0 || warehouseIds.includes(u.locationId)) &&
          (bands.length === 0 ||
            bands.includes(
              batteryBandOf(readUnitBattery(u, db, batterySettings)),
            )),
      ),
    [db.units, warehouseIds, bands],
  );

  const all = useMemo(
    () =>
      rollUpInventory(units, db.skus, db.models, {
        markupPct,
        battery: batterySettings,
      }),
    [units, db.skus, db.models, markupPct],
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
        placeholder={t("inventory.anyBattery", "Any battery")}
        value={bands}
        onChange={setBands}
        /*
         * The band NAME, not its numbers (2026-09-08).
         *
         * One filter over a shelf that holds both eras: a "Good (80%+)" option
         * beside a "Good (400 cycles or fewer)" one would split every search
         * over a shop that sells 2017 Airs and M2s alike. The numbers still
         * appear — in the column guide, and in Settings where they are set.
         */
        options={[
          ...(["good", "fair", "bad"] as const).map((g) => ({
            value: BATTERY_BAND_LABEL[g],
            label: BATTERY_BAND_LABEL[g],
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
  /**
   * A price range as one cell: one figure, or a dash between two.
   *
   * `single` comes off `priceRange` rather than being recomputed here, so a
   * row where every machine asks the same money reads as one number in every
   * place this appears rather than as "Rp9.000.000–Rp9.000.000".
   */
  const Money = ({ range }: { range: PriceRange }) => {
    if (range.count === 0) return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <Typography.Text>
        {range.single
          ? fmtRp(range.min)
          : `${fmtRp(range.min)} – ${fmtRp(range.max)}`}
      </Typography.Text>
    );
  };

  /**
   * Write a repricing: the units, and one ledger row each.
   *
   * One `mutate` for the whole grid, because that is what the dialog is — one
   * decision about eleven machines — and eleven mutations would be eleven
   * re-renders and eleven chances to stop halfway. The event is `DICATAT`
   * rather than `KOREKSI`: nothing about the machine is being corrected, a
   * price is being recorded, and the timeline should read as the shop
   * deciding rather than as somebody fixing a mistake.
   */
  const applyPriceEdits = (edits: readonly PriceEdit[]) => {
    if (edits.length === 0) return;
    mutate((d) => {
      for (const e of edits) {
        const u = d.units.find((x) => x.serial === e.serial);
        if (!u) continue;
        const sku = d.skus.find((s) => s.id === u.skuId);
        const before = priceOf(u, sku?.price ?? 0);
        const beforeMarket = marketPriceOf(u, sku?.price ?? 0, markupPct);
        u.price = e.price;
        u.marketPrice = e.marketPrice;
        const afterMarket = marketPriceOf(u, sku?.price ?? 0, markupPct);
        appendEvent(d, e.serial, {
          type: "DICATAT",
          note: [
            before === e.price
              ? undefined
              : `Price ${fmtRp(before)} → ${fmtRp(e.price)}`,
            beforeMarket === afterMarket
              ? undefined
              : `Marketplace ${fmtRp(beforeMarket)} → ${fmtRp(afterMarket)}`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    });
    message.success(
      t("inventory.repriced", "{{n}} prices updated.", { n: edits.length }),
    );
  };

  /** The button that opens the price grid on a set of machines. */
  const repriceButton = (title: string, units: readonly Unit[]) => (
    <Tooltip
      title={
        units.length === 0
          ? t("inventory.nothingToPrice", "No machines to price")
          : t("inventory.editPricesN", "Edit {{count}} prices", {
              count: units.length,
            })
      }
    >
      <Button
        type="text"
        icon={<TagsOutlined />}
        disabled={units.length === 0}
        aria-label={t("inventory.editPricesFor", "Edit prices for {{what}}", {
          what: title,
        })}
        onClick={() => setRepricing({ title, units })}
      />
    </Tooltip>
  );

  /**
   * The serials behind one grade of one product.
   *
   * A plain `<Table>`, not a `DataTable`: this is already two levels inside a
   * row of one, and a nested pager would be a second set of page controls
   * inside the first one's page. A grade with forty serials scrolls; that is
   * the right cost for the rarest row in the list.
   */
  const serialsOf = (units: readonly Unit[]) => (
    <Table<Unit>
      size="small"
      rowKey="serial"
      dataSource={units as Unit[]}
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
          /*
           * The battery, in whichever units this machine's era reports
           * (2026-09-08). The capacity rides under the cycle count rather than
           * taking a column of its own: it is context for the count, and on a
           * 2021-or-later machine there is nothing to put in that column.
           */
          title: t("inventory.battery", "Battery"),
          key: "battery",
          width: 130,
          align: "right",
          render: (_: unknown, u: Unit) => {
            const read = readUnitBattery(u, db, batterySettings);
            return (
              <Flex vertical align="flex-end" gap={0}>
                <Typography.Text>{read.text}</Typography.Text>
                {read.fcc !== undefined && (
                  <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                    {fmtFcc(read.fcc)}
                  </Typography.Text>
                )}
              </Flex>
            );
          },
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
          width: 280,
          render: (v: string) => <LongText>{v}</LongText>,
        },
        {
          /*
           * What the machine has COST, not only what it was bought for
           * (owner ask 2026-09-08). A repair is a second cost against the
           * same serial, and the second line says so when there is one —
           * without it a machine that came back from the bench shows a margin
           * it has not earned.
           */
          title: t("inventory.buy", "Cost"),
          key: "buy",
          width: 140,
          align: "right",
          render: (_: unknown, u: Unit) => {
            const repair = serviceCostOf(u.serial, db.services);
            return (
              <Flex vertical align="flex-end" gap={0}>
                <Typography.Text>{fmtRp(u.buy + repair)}</Typography.Text>
                {repair > 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {t("inventory.inclRepair", "incl. {{amount}} repair", {
                      amount: fmtRp(repair),
                    })}
                  </Typography.Text>
                )}
              </Flex>
            );
          },
        },
        {
          /*
           * What THIS machine asks (owner revision 2026-09-08). A machine that
           * has not been priced quotes the variant's asking price and says so
           * — "not priced yet" and "priced at the catalogue figure" are
           * different facts, and only one of them is somebody's decision.
           */
          title: t("inventory.storePrice", "Store price"),
          key: "price",
          width: 140,
          align: "right",
          render: (_: unknown, u: Unit) => (
            <Flex vertical align="flex-end" gap={0}>
              <Typography.Text>
                {fmtRp(priceOf(u, skuPriceOf(u.skuId)))}
              </Typography.Text>
              {u.price === undefined && (
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {t("inventory.notPricedYet", "not priced yet")}
                </Typography.Text>
              )}
            </Flex>
          ),
        },
        {
          title: t("inventory.marketPrice", "Marketplace"),
          key: "market",
          width: 140,
          align: "right",
          render: (_: unknown, u: Unit) => (
            <Flex vertical align="flex-end" gap={0}>
              <Typography.Text>
                {fmtRp(marketPriceOf(u, skuPriceOf(u.skuId), markupPct))}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {isMarketPriceOverridden(u)
                  ? t("inventory.setByHand", "set by hand")
                  : t("inventory.fromRule", "+{{pct}}%", { pct: markupPct })}
              </Typography.Text>
            </Flex>
          ),
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

  /**
   * The grades behind one product row (owner ask 2026-09-08).
   *
   * A second rung, and the owner asked for it because with a price per serial
   * "what does a MacBook Air M2 16/512 cost?" stopped having one answer. Grade
   * is the axis that MAKES the answers differ — an A and a C are two products
   * as far as a customer is concerned — so the price range is shown per grade,
   * and within a grade it still spreads because a tired battery is worth less
   * than a fresh one. That inner spread is what the range is actually for.
   */
  const gradesOf = (row: InventoryRow) => (
    <Table<GradeGroup>
      size="small"
      rowKey={(g) => g.grade ?? "—"}
      dataSource={gradeGroupsOf(row, skuPriceOf(row.skuId), markupPct)}
      pagination={false}
      expandable={{
        expandedRowRender: (g) => serialsOf(g.units),
        defaultExpandAllRows: false,
      }}
      columns={[
        {
          title: t("inventory.grade", "Grade"),
          key: "grade",
          width: 110,
          render: (_: unknown, g: GradeGroup) => <GradeTag grade={g.grade} />,
        },
        {
          title: t("inventory.qty", "Qty"),
          key: "qty",
          width: 170,
          align: "right",
          render: (_: unknown, g: GradeGroup) => (
            <Flex vertical align="flex-end" gap={0}>
              <Qty n={g.onHand} strong />
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t("inventory.nAvailable", "{{n}} available", {
                  n: g.available,
                })}
              </Typography.Text>
            </Flex>
          ),
        },
        {
          title: t("inventory.storePrice", "Store price"),
          key: "store",
          align: "right",
          render: (_: unknown, g: GradeGroup) => <Money range={g.store} />,
        },
        {
          title: t("inventory.marketPrice", "Marketplace"),
          key: "market",
          align: "right",
          render: (_: unknown, g: GradeGroup) => <Money range={g.market} />,
        },
        {
          title: "",
          key: "reprice",
          width: 56,
          render: (_: unknown, g: GradeGroup) =>
            repriceButton(
              `${row.product} ${row.specs} · ${g.grade ?? t("inventory.ungraded", "Ungraded")}`,
              g.units,
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
          expandedRowRender: gradesOf,
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
            // Settings can change underneath it — and since 2026-09-08 it also
            // explains that there are two of them.
            title: (
              <Flex align="center" gap={SPACE.xs}>
                {t("inventory.batteryHealth", "Battery")}
                <Tooltip title={batteryEraGuide(batterySettings)}>
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
            width: 160,
            // Sorts on the WORST reading held — "show me the tiredest
            // batteries first" — and deliberately does NOT get a header
            // filter: the band select above the table is the honest one,
            // because it narrows UNITS and the quantities move with it. A
            // second one here would filter rows on the worst reading of a
            // range and leave "3 available" beside a filter only one of the
            // three meets.
            //
            // Worst is a different NUMBER in each era: the lowest percentage,
            // but the highest cycle count. Sorting on the raw figure would
            // interleave the two eras meaninglessly, so this sorts on the
            // band, which is the one thing they share.
            sortValue: (r) =>
              r.batteryMin === undefined
                ? 9
                : ["good", "fair", "bad"].indexOf(
                    (r.batteryEra === "CYCLES"
                      ? cycleGrade(r.batteryMax, batterySettings.cycles)
                      : batteryGrade(r.batteryMin, batterySettings.health)) ??
                      "good",
                  ),
            render: (_, r) => {
              if (r.batteryMin === undefined) return "—";
              const fmt =
                r.batteryEra === "CYCLES" ? fmtCycleCount : fmtBatteryHealth;
              const text =
                r.batteryMin === r.batteryMax
                  ? fmt(r.batteryMin)
                  : `${fmt(r.batteryMin)}–${fmt(r.batteryMax)}`;
              // Coloured by the WORST reading in the range, not the best: a
              // product whose range spans a band boundary is one a buyer can
              // still be handed the tired unit from. Which END is the worst
              // flips with the era — fewer cycles is better, more percent is.
              const grade =
                r.batteryEra === "CYCLES"
                  ? cycleGrade(r.batteryMax, batterySettings.cycles)
                  : batteryGrade(r.batteryMin, batterySettings.health);
              return grade === null ? (
                text
              ) : (
                <Tag color={BATTERY_GRADE_COLOR[grade]}>{text}</Tag>
              );
            },
          },
          {
            /*
             * A RANGE again (owner revision 2026-09-08), and for the reason
             * this column carried one before 2026-08-27: each serial is priced
             * at QC and they usually differ. What is different this time is
             * the second line — the marketplace figure, which most of the
             * shelf derives from the first by a rule.
             *
             * The variant's asking price is not shown here. It is the number a
             * new machine STARTS from, not one anything is sold at, and a
             * column showing both invited the reading that one of them is the
             * real price.
             */
            title: t("inventory.price", "Price"),
            key: "price",
            width: 220,
            align: "right",
            sortValue: (r) => (r.store.count === 0 ? r.listPrice : r.store.min),
            render: (_, r) => (
              <Flex vertical align="flex-end" gap={0}>
                <Money range={r.store} />
                {r.market.count > 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {r.market.single
                      ? t("inventory.marketOne", "marketplace {{price}}", {
                          price: fmtRp(r.market.min),
                        })
                      : t(
                          "inventory.marketRange",
                          "marketplace {{from}} – {{to}}",
                          { from: fmtRp(r.market.min), to: fmtRp(r.market.max) },
                        )}
                  </Typography.Text>
                )}
              </Flex>
            ),
          },
          {
            title: "",
            key: "reprice",
            width: 44,
            render: (_, r) =>
              repriceButton(`${r.product} ${r.specs}`, r.units),
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

      <PriceEditorModal
        open={repricing !== null}
        units={repricing?.units ?? []}
        skuPrice={skuPriceOf}
        markupPct={markupPct}
        title={repricing?.title ?? ""}
        onClose={() => setRepricing(null)}
        onSave={(edits) => {
          applyPriceEdits(edits);
          setRepricing(null);
        }}
      />
    </>
  );
}
