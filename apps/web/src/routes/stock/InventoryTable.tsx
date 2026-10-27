/**
 * What the shop holds, as one flat table: a line per variant, grade and
 * warehouse, and the units behind a line nested under it (2026-10-02).
 *
 * ## Why flat
 *
 * > *"The previous design is less intuitive for them since it is nested."*
 *
 * From 2026-08-26 this was one table with expanding rows — a product opened
 * onto its grades (2026-09-08), each grade onto its serials — and the answer
 * to the question staff actually bring ("how many A-grade Air M2 16/512 are in
 * Serpong, and what do they ask?") lived two clicks down, in a different place
 * for every product. A line is now that question: one variant at one grade in
 * one warehouse, with its count, what it cost and what it asks on the line.
 * `lib/inventory.ts` builds the lines and says why those axes.
 *
 * The serials are one click away: clicking a line opens its units UNDER it —
 * battery, status, rack, description, what each cost (the "i" breaks it
 * down) and what it asks — with the per-unit buttons. This was a popup from
 * 2026-09-19 and became a nested row again on 2026-10-02 (owner ask: *"instead
 * of showing popup in the UI when a row is clicked, use nested column"*).
 * The lines stay flat — one level, never product → grade → serial — so the
 * 2026-09-19 complaint does not come back. ⚠️ An expanding table keeps its
 * grid on a phone (DataTable's docblock), so this list is no longer cards.
 *
 * ## Two kinds of filter, and the split matters before editing this file
 *
 * - **Above the table (category, battery)** filters UNITS, before the lines
 *   are built. That keeps the quantities honest: with a poor-battery filter
 *   on, "3 available" means three units in that band, not a line that owns
 *   one. Battery has no column to hang a header filter on — it varies per
 *   unit — and neither has category.
 * - **In the column headers (product, grade, warehouse)** filters LINES. A
 *   line is one grade in one warehouse, so narrowing lines by either IS
 *   narrowing units by it and every quantity on screen still means what it
 *   says — the reason the warehouse filter could move into its column when
 *   the table went flat (it had to sit above the table while a row spanned
 *   several warehouses).
 *
 * `Scope` is the last control: a variant with nothing in stock is still an
 * answer — "not right now" — so "All products" adds an empty line for it.
 *
 * ## Prices
 *
 * Unit price is `Unit.buy`, what the invoice charged, as Inbound names it; the
 * COGS under it adds the invoice's expenses and the repairs when those are
 * anything (`costIndex` — the expense share was missing here until
 * 2026-09-19). Sell price is what the units on sale ask, per serial since
 * 2026-09-08, and under it the variant's marketplace price: the highest of
 * its units' (`variantMarketPrice`), the same on every line of the variant
 * because a listing is one price.
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { SerialLink } from "../../components/SerialLink";
import {
  App,
  Button,
  Dropdown,
  Flex,
  Segmented,
  Select,
  theme,
  Tooltip,
  Typography,
} from "antd";
import {
  EditOutlined,
  MoreOutlined,
  PrinterOutlined,
  QuestionCircleOutlined,
  RollbackOutlined,
  TagsOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { SendToServiceModal } from "../../components/SendToServiceModal";
import { SupplierReturnModal } from "../../components/SupplierReturnModal";
import { supplierReturnBlock } from "../../lib/supplierReturn.js";
import { sendToServiceBlock } from "../../lib/serviceActions.js";
import { ProTable } from "../../components/ProTable";
import { DataTable } from "../../components/DataTable";
import { EnumTag } from "../../components/EnumTag";
import { LongText } from "../../components/LongText";
import { GradeTag } from "../../components/GradeTag";
import { UnitPhotos } from "../../components/UnitPhotos";
import { CostInfoButton } from "../../components/CostBreakdown";
import { PrintLabelsModal } from "../../components/LabelSheet";
import { UnitEditModal } from "./UnitEditModal";
import { labelsFor } from "../../lib/labels.js";
import type { LabelDatum } from "../../lib/labels.js";
import { fmtDateTime, fmtNone, fmtRp } from "../../lib/format.js";
import {
  BATTERY_BAND_LABEL,
  BATTERY_UNKNOWN,
  batteryBandOf,
  batteryEraGuide,
  batterySettingsFrom,
  fmtFcc,
  readUnitBattery,
} from "../../lib/battery.js";
import { inventoryLines, type InventoryLine } from "../../lib/inventory.js";
import {
  DEFAULT_MARKETPLACE_MARKUP_PCT,
  priceOf,
  variantMarketPrices,
  type PriceRange,
} from "../../lib/unitPrice.js";
import { costIndex } from "../../lib/service.js";
import { gradeRank, gradeText } from "../../lib/condition.js";
import {
  PriceEditorModal,
  type PriceEdit,
} from "../../components/PriceEditorModal.js";
import { appendEvent, mutate, qcPhotosOf, useDb } from "../../mock/store.js";
import { STOCK_MOVE, UNIT_STATUS, labelOf } from "../../i18n/enumLabels.js";
import { averageCost, stockLevels } from "../../lib/stock.js";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";
import type { StockMove, Unit } from "../../mock/seed.js";
import { warehouseLabelOf } from "../../lib/warehouses.js";
import { softHolds } from "../../lib/reservations.js";
import { customerLabel } from "../../lib/customers.js";

/** A quantity cell: the number, or a muted zero that does not shout. */
function Qty({ n, strong }: { n: number; strong?: boolean }) {
  if (n === 0) {
    return <Typography.Text type="secondary">0</Typography.Text>;
  }
  return <Typography.Text strong={strong}>{n}</Typography.Text>;
}

/**
 * A price range as text: one figure, or a dash between two.
 *
 * `single` comes off `priceRange` rather than being recomputed here, so a
 * line where every unit asks the same money reads as one number rather than
 * as "Rp9.000.000 – Rp9.000.000".
 */
function rangeText(range: PriceRange): string {
  return range.single
    ? fmtRp(range.min)
    : `${fmtRp(range.min)} – ${fmtRp(range.max)}`;
}

/**
 * Was this click aimed at a control inside the line rather than the line?
 *
 * The checkbox's own cell, a button, a link: each does its own thing, and
 * opening the line under it would be a second answer to one click.
 * `closest` walks up from the target, so a click on a button's icon counts.
 */
function onAControl(e: MouseEvent<HTMLElement>): boolean {
  const target = e.target as HTMLElement | null;
  return (
    target?.closest(
      "button, a, input, label, .ant-table-selection-column, .ant-checkbox-wrapper",
    ) != null
  );
}

export interface InventoryTableProps {
  /** The page's own primary actions, rendered at the top right of the table. */
  extra?: React.ReactNode;
}

export function InventoryTable({ extra }: InventoryTableProps) {
  const db = useDb();
  const softHeld = useMemo(() => softHolds(db), [db]);
  const { message } = App.useApp();
  const { t } = useTranslation();
  const { compact } = useLayoutMode();
  const {
    token: { colorTextSecondary },
  } = theme.useToken();

  const [categories, setCategories] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [scope, setScope] = useState<"STOCKED" | "ALL">("STOCKED");
  /** Null when the print dialog is closed; the sheet's contents when it is. */
  const [printing, setPrinting] = useState<LabelDatum[] | null>(null);
  /** Null when the price grid is shut; what it is repricing when it is open. */
  const [repricing, setRepricing] = useState<{
    title: string;
    units: readonly Unit[];
  } | null>(null);
  /** The unit being corrected, or null (owner ask 2026-09-23). */
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  /** The unit the Send-to-service dialog is open on (2026-10-26). */
  const [servicing, setServicing] = useState<string | null>(null);
  /** The unit the Return-to-supplier dialog is open on (2026-10-26). */
  const [returning, setReturning] = useState<string | null>(null);
  /**
   * The lines open to show their units (owner ask 2026-10-02: *"instead of
   * showing popup in the UI when a row is clicked, use nested column"*).
   * Several at once — comparing two warehouses' A-grades side by side is the
   * thing a popup could never do.
   */
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const toggle = (key: string) =>
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  // The shop's thresholds, not the library defaults: Settings can move them.
  const batterySettings = batterySettingsFrom(db.settings);
  const markupPct =
    db.settings.marketplaceMarkupPct ?? DEFAULT_MARKETPLACE_MARKUP_PCT;
  const skuPriceOf = (skuId: string) =>
    db.skus.find((s) => s.id === skuId)?.price ?? 0;
  const warehouseName = (id: string | undefined) =>
    id === undefined ? undefined : (warehouseLabelOf(db.warehouses, id) ?? id);
  const rackName = (id?: string) => db.racks.find((r) => r.id === id)?.name;
  const gradeLabel = (grade: string | undefined) =>
    gradeText(grade, t("grade.new", "New")) ??
    t("inventory.ungraded", "Ungraded");
  const categoryOf = (skuId: string) => {
    const sku = db.skus.find((s) => s.id === skuId);
    return db.models.find((m) => m.id === sku?.modelId)?.category;
  };

  /** What every unit has cost, read off the store once per change. */
  const costOf = useMemo(
    () => costIndex(db),
    [db.pos, db.units, db.events, db.services],
  );

  const units = useMemo(
    () =>
      db.units.filter(
        (u) =>
          (categories.length === 0 ||
            categories.includes(categoryOf(u.skuId) ?? "")) &&
          (bands.length === 0 ||
            bands.includes(
              batteryBandOf(readUnitBattery(u, db, batterySettings)),
            )),
      ),
    // `batterySettings` and `categoryOf` are rebuilt every render from the
    // store slices listed here.
    [db.units, db.skus, db.models, db.settings, categories, bands],
  );

  const lines = useMemo(
    () =>
      inventoryLines(units, db, {
        costOf: (u) => costOf(u).total,
        includeEmpty: scope === "ALL",
        // Accessories, off the stock ledger (2026-09-19). A battery filter
        // leaves them out — they have no battery to be in a band.
        counted: {
          levels: stockLevels(db.stockMoves),
          averageCost: (skuId) => averageCost(db, skuId),
          include: (skuId) =>
            bands.length === 0 &&
            (categories.length === 0 ||
              categories.includes(categoryOf(skuId) ?? "")),
        },
      }),
    [
      units,
      db.skus,
      db.models,
      db.warehouses,
      db.categories,
      db.stockMoves,
      db.pos,
      costOf,
      scope,
      bands,
      categories,
    ],
  );

  /**
   * Each variant's marketplace price, over the WHOLE store rather than the
   * filtered view: a listing is the variant's, and a battery filter on this
   * screen does not change what Shopee shows.
   */
  const marketBySku = useMemo(
    () => variantMarketPrices(db.units, skuPriceOf, markupPct),
    [db.units, db.skus, markupPct],
  );

  // A line that disappears while open — its last unit moved to another
  // warehouse by an edit made from inside it — is forgotten, rather than
  // leaving a key that would reopen it if the line ever came back.
  useEffect(() => {
    const live = new Set(lines.map((l) => l.key));
    if (expanded.some((k) => !live.has(k))) {
      setExpanded((prev) => prev.filter((k) => live.has(k)));
    }
  }, [lines, expanded]);

  const totalHeld = lines.reduce((n, l) => n + l.onHand, 0);
  const totalValue = lines.reduce((n, l) => n + l.value, 0);
  const products = new Set(lines.map((l) => l.skuId)).size;

  const categoryNames = [
    ...new Set([
      ...db.categories.map((c) => c.name),
      ...db.models.map((m) => m.category),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const lineTitle = (l: InventoryLine) =>
    [
      `${l.product} ${l.specs}`.trim(),
      l.onHand > 0 ? gradeLabel(l.grade) : undefined,
      warehouseName(l.locationId),
    ]
      .filter(Boolean)
      .join(" · ");

  /**
   * The units behind a line, drawn under it when it is opened. A counted
   * product has no units, so it shows what moved its shelf instead.
   */
  const unitsOf = (l: InventoryLine) => (
    <>
      {l.counted && (
        <DataTable<StockMove>
          rowKey="id"
          size="small"
          dataSource={db.stockMoves
            .filter((m) => m.skuId === l.skuId && m.locationId === l.locationId)
            .sort((a, b) => b.at.localeCompare(a.at))}
          paginated={false}
          columns={[
            {
              title: t("inventory.moveWhen", "When"),
              key: "at",
              render: (_, m) => fmtDateTime(m.at),
            },
            {
              title: t("inventory.moveWhat", "What"),
              key: "type",
              render: (_, m) => labelOf(STOCK_MOVE, m.type, t),
            },
            {
              title: t("inventory.moveDoc", "Document"),
              key: "ref",
              render: (_, m) => m.refCode ?? fmtNone(),
            },
            {
              title: t("inventory.moveQty", "Qty"),
              key: "qty",
              align: "right",
              render: (_, m) => (
                <Typography.Text type={m.qty > 0 ? "success" : "danger"}>
                  {m.qty > 0 ? `+${m.qty}` : m.qty}
                </Typography.Text>
              ),
            },
          ]}
        />
      )}
      {!l.counted && (
        /*
         * Wrapped rather than given a className: `DataTable` takes none, and
         * the dialog is wide enough (owner ask 2026-09-23) that the cells
         * need a tighter rhythm or the eye has to travel between a serial
         * and the price on the same row.
         */
        <div className="unit-popup-table">
          <DataTable<Unit>
            rowKey="serial"
            size="small"
            dataSource={l.units}
            columns={unitColumns(l)}
            // A pager only when a line is long enough to need one: a line is
            // one grade in one warehouse, and most hold a handful.
            paginated={l.units.length > 20}
          />
        </div>
      )}
    </>
  );

  const filters = (
    <>
      <Select
        mode="multiple"
        allowClear
        maxTagCount="responsive"
        placeholder={t("inventory.anyCategory", "Any category")}
        aria-label={t("inventory.anyCategory", "Any category")}
        value={categories}
        onChange={setCategories}
        options={categoryNames.map((c) => ({ value: c, label: c }))}
        style={{ minWidth: 200 }}
      />
      <Flex align="center" gap={SPACE.xs}>
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder={t("inventory.anyBattery", "Any battery")}
          aria-label={t("inventory.anyBattery", "Any battery")}
          value={bands}
          onChange={setBands}
          /*
           * The band NAME, not its numbers (2026-09-08).
           *
           * One filter over a shelf that holds both eras: a "Good (80%+)"
           * option beside a "Good (400 cycles or fewer)" one would split every
           * search over a shop that sells 2017 Airs and M2s alike. The numbers
           * are in the `?` beside it, and in Settings where they are set.
           */
          options={[
            ...(["good", "fair", "bad"] as const).map((g) => ({
              value: BATTERY_BAND_LABEL[g],
              label: BATTERY_BAND_LABEL[g],
            })),
            { value: BATTERY_UNKNOWN, label: BATTERY_UNKNOWN },
          ]}
          style={{ minWidth: 200, flex: 1 }}
        />
        {/* What the bands mean, with the shop's own thresholds — the only
            honest way to label a filter Settings can move underneath it. */}
        <Tooltip title={batteryEraGuide(batterySettings, t)}>
          <QuestionCircleOutlined
            style={{ color: colorTextSecondary, cursor: "help" }}
            aria-label={t(
              "inventory.batteryBandsAria",
              "What the battery bands mean",
            )}
          />
        </Tooltip>
      </Flex>
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
   * Write a repricing: the units, and one ledger row each.
   *
   * One `mutate` for the whole grid, because that is what the dialog is — one
   * decision about eleven units — and eleven mutations would be eleven
   * re-renders and eleven chances to stop halfway. The event is `DICATAT`
   * rather than `KOREKSI`: nothing about the unit is being corrected, a price
   * is being recorded.
   *
   * A unit that still carries a marketplace price typed by hand before
   * 2026-09-19 is handed back to the rule here, in the same write. Nothing
   * can edit that number any more (the listing became the variant's), and
   * left alone it would go on setting the variant's listing — the maximum —
   * for as long as the unit is on the shelf; pricing the unit again is the
   * moment somebody has looked at it.
   */
  const applyPriceEdits = (edits: readonly PriceEdit[]) => {
    if (edits.length === 0) return;
    mutate((d) => {
      for (const e of edits) {
        const u = d.units.find((x) => x.serial === e.serial);
        if (!u) continue;
        const sku = d.skus.find((s) => s.id === u.skuId);
        const before = priceOf(u, sku?.price ?? 0);
        const repriced = before !== e.price;
        // A grade-only edit leaves the price, and the hand-typed marketplace
        // price with it, exactly as they were.
        const handTyped = repriced ? u.marketPrice : undefined;
        const gradeBefore = u.grade ?? null;
        if (repriced) u.price = e.price;
        if (handTyped !== undefined) u.marketPrice = undefined;
        if (e.grade !== undefined)
          u.grade = (e.grade ?? undefined) as Unit["grade"];
        appendEvent(d, e.serial, {
          type: "DICATAT",
          note: [
            repriced ? `Price ${fmtRp(before)} → ${fmtRp(e.price)}` : undefined,
            e.grade === undefined
              ? undefined
              : `Grade ${gradeBefore ?? "none"} → ${e.grade ?? "none"}`,
            handTyped === undefined
              ? undefined
              : `Marketplace price ${fmtRp(handTyped)} set by hand dropped — the variant's listing follows the rule`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    });
    message.success(
      t("inventory.unitsUpdated", "{{n}} units updated.", { n: edits.length }),
    );
  };

  /** The units behind the open line, one row each. */
  /**
   * A unit row's ⋯ (owner ask 2026-10-26): the decisions about one unit that
   * are not a price or a correction. *Send to service* opens the one dialog
   * every door shares; a unit that cannot go is drawn switched off, saying
   * why. *Return to supplier* sits beside it (2026-10-26).
   */
  const unitMenu = (u: Unit): MenuProps => {
    const block = sendToServiceBlock(u.status);
    const why =
      block === "HELD"
        ? t(
            "service.heldCannotGo",
            "Reserved for a customer — release the hold first.",
          )
        : block === "AT_SERVICE"
          ? t("service.alreadyAway", "Already at service.")
          : block === "NOT_IN_STOCK"
            ? t("service.notInStock", "Not in stock.")
            : undefined;
    const sendLabel = t("inbound.serviceOk", "Send to service");
    /*
     * Back to the supplier (2026-10-26) — from the shelf or from service, the
     * one dialog every door opens. A held unit is the customer's.
     */
    const returnBlock = supplierReturnBlock(u.status);
    const returnWhy =
      returnBlock === "HELD"
        ? t(
            "service.heldCannotGo",
            "Reserved for a customer — release the hold first.",
          )
        : returnBlock === "NOT_IN_STOCK"
          ? t("service.notInStock", "Not in stock.")
          : undefined;
    const returnLabel = t("inbound.rejectOk", "Return to supplier");
    return {
      items: [
        {
          key: "service",
          icon: <ToolOutlined aria-hidden />,
          disabled: why !== undefined,
          label:
            why === undefined ? (
              sendLabel
            ) : (
              <Tooltip title={why}>
                <span>{sendLabel}</span>
              </Tooltip>
            ),
        },
        {
          key: "return",
          icon: <RollbackOutlined aria-hidden />,
          disabled: returnWhy !== undefined,
          label:
            returnWhy === undefined ? (
              returnLabel
            ) : (
              <Tooltip title={returnWhy}>
                <span>{returnLabel}</span>
              </Tooltip>
            ),
        },
      ],
      onClick: ({ key }) => {
        if (key === "service") setServicing(u.serial);
        if (key === "return") setReturning(u.serial);
      },
    };
  };

  const unitColumns = (line: InventoryLine) => [
    {
      title: t("inventory.serial", "Serial"),
      dataIndex: "serial",
      key: "serial",
      render: (v: string) => <SerialLink serial={v} />,
    },
    // No Grade and no warehouse here (2026-10-02): the units sit under their
    // line now, and a line IS one grade in one warehouse — both are on the row
    // above. The popup needed them; a nested row repeating them only pushed
    // the prices and the buttons off the side of the screen.
    // No battery for a category the shop counts rather than identifies: a
    // sleeve has none, and a column of "None" would answer a question nobody
    // asked (2026-09-19).
    ...(line.tracksSerial
      ? [
          {
            /*
             * In whichever reading this unit's era reports (2026-09-08). The
             * capacity rides under the cycle count rather than taking a
             * column of its own: it is context for the count.
             */
            title: t("inventory.battery", "Battery"),
            key: "battery",
            width: COLUMN.tag,
            align: "right" as const,
            render: (_: unknown, u: Unit) => {
              const read = readUnitBattery(u, db, batterySettings);
              return (
                <Flex vertical align="flex-end" gap={0}>
                  <Typography.Text>{read.text}</Typography.Text>
                  {read.fcc !== undefined && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {fmtFcc(read.fcc)}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
        ]
      : []),
    {
      title: t("inventory.status", "Status"),
      dataIndex: "status",
      key: "status",
      width: COLUMN.tag,
      render: (v: string, u: Unit) => {
        // Reserved for somebody who paid no DP (2026-10-27): still on sale.
        const r = softHeld.get(u.serial);
        const who = r && db.customers.find((c) => c.id === r.customerId);
        return (
          <Flex vertical gap={2} align="flex-start">
            <EnumTag map={UNIT_STATUS} value={v} />
            {r && (
              <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
                {t("pos.reservedNotPaid", "Reserved for {{name}}, not paid", {
                  name: who ? customerLabel(who) : r.code,
                })}
              </Typography.Text>
            )}
          </Flex>
        );
      },
    },
    {
      title: t("inventory.rack", "Rack"),
      key: "rack",
      width: COLUMN.qty,
      render: (_: unknown, u: Unit) => rackName(u.rackId) ?? fmtNone(),
    },
    {
      // Two lines, not one (owner decision 2026-08-26). This is the column
      // staff write a sentence into; see `LongText`.
      title: t("inventory.description", "Description"),
      dataIndex: "description",
      key: "description",
      // Takes the slack; its floor is low so the unit rows fit 1440 beside
      // the sider now that Unit price carries its "i" on one line.
      minWidth: COLUMN.flex,
      render: (v: string) => <LongText>{v}</LongText>,
    },
    // The QC photographs of this serial (owner ask 2026-09-29), read-only:
    // they are gathered at Inbound & QC and at a stock count, and this list
    // is where somebody checks a unit's condition before quoting it. Counted
    // lines have no serial to photograph.
    ...(line.tracksSerial
      ? [
          {
            title: t("inventory.photos", "Photos"),
            key: "photos",
            // Three 32px thumbnails and their gaps.
            width: COLUMN.tag,
            render: (_: unknown, u: Unit) =>
              qcPhotosOf(db, u.serial).length === 0 ? (
                fmtNone()
              ) : (
                <UnitPhotos serial={u.serial} size={32} max={3} />
              ),
          },
        ]
      : []),
    {
      /*
       * What the invoice charged for this unit — its "Unit price", as Inbound
       * calls it — with the "i" that takes the COGS apart: the invoice line,
       * its share of the invoice's shipping, tax and other expenses, and its
       * repairs (owner ask 2026-09-19).
       */
      title: t("inventory.unitPrice", "Unit price"),
      key: "buy",
      // The figure and its "i" on one line: at the bare money width the
      // button pushed "Rp" onto a line of its own (owner report 2026-10-21).
      width: COLUMN.money + COLUMN.antdControl,
      align: "right" as const,
      render: (_: unknown, u: Unit) => {
        const cost = costOf(u);
        return (
          <Flex align="center" justify="flex-end" gap={SPACE.xs}>
            <Flex vertical align="flex-end" gap={0}>
              <Typography.Text style={{ whiteSpace: "nowrap" }}>
                {fmtRp(cost.buy)}
              </Typography.Text>
              {cost.total !== cost.buy && (
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: TYPE.sm, whiteSpace: "nowrap" }}
                >
                  {t("inventory.cogsOne", "COGS {{amount}}", {
                    amount: fmtRp(cost.total),
                  })}
                </Typography.Text>
              )}
            </Flex>
            <CostInfoButton serial={u.serial} cost={cost} />
          </Flex>
        );
      },
    },
    {
      /*
       * What THIS unit asks (owner revision 2026-09-08). A unit that has not
       * been priced quotes the variant's asking price and says so — "not
       * priced yet" and "priced at the catalogue figure" are different facts.
       */
      title: t("inventory.sellPrice", "Sell price"),
      key: "price",
      width: COLUMN.money,
      align: "right" as const,
      render: (_: unknown, u: Unit) => (
        <Flex vertical align="flex-end" gap={0}>
          <Typography.Text style={{ whiteSpace: "nowrap" }}>
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
      // Untitled: this codebase's actions column, which a phone card puts at
      // its foot. Price change and edit unit (owner ask 2026-09-23) — the two
      // things anybody opens a line to do.
      title: "",
      key: "actions",
      width: COLUMN.actions,
      // Pinned: when a narrow screen scrolls the units sideways, the two
      // things anybody opens a line to do stay in reach.
      fixed: compact ? undefined : ("right" as const),
      render: (_: unknown, u: Unit) => (
        <Flex gap={4}>
          <Tooltip title={t("inventory.priceChange", "Price change")}>
            <Button
              size="small"
              aria-label={t(
                "inventory.priceChangeAria",
                "Change the price of {{serial}}",
                { serial: u.serial },
              )}
              icon={<TagsOutlined />}
              onClick={() => setRepricing({ title: u.serial, units: [u] })}
            />
          </Tooltip>
          <Tooltip title={t("inventory.editUnit", "Edit unit")}>
            <Button
              size="small"
              aria-label={t("inventory.editUnitAria", "Edit {{serial}}", {
                serial: u.serial,
              })}
              icon={<EditOutlined />}
              onClick={() => setEditingUnit(u)}
            />
          </Tooltip>
          <Dropdown trigger={["click"]} menu={unitMenu(u)}>
            <Button
              size="small"
              type="text"
              icon={<MoreOutlined aria-hidden />}
              aria-label={t("inventory.unitMoreAria", "More for {{serial}}", {
                serial: u.serial,
              })}
            />
          </Dropdown>
        </Flex>
      ),
    },
  ];

  return (
    <>
      {/* `inventory-lines` gives the units nested under a line the width
          antd's padding would otherwise take (global.css). */}
      <div className="inventory-lines">
        <ProTable<InventoryLine>
          persistKey="inventory"
          rowKey="key"
          dataSource={lines}
          selectable
          // Printing a shelf's worth of stickers at once is the reason batch
          // selection exists here: a stock take that relabels three lines
          // should be one trip to the printer, not three.
          bulkActions={(selected, clear) => (
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              onClick={() => {
                const picked = selected.flatMap((l) => l.units);
                setPrinting(labelsFor(picked, db.skus, db.models));
                clear();
              }}
            >
              {t("inventory.printN", "Print labels ({{count}})", {
                count: selected.reduce((n, l) => n + l.units.length, 0),
              })}
            </Button>
          )}
          // A line is a control: a click, or Enter from the keyboard, opens its
          // units under it and closes them again. An empty line ("All
          // products") has none to open.
          onRow={(l) => ({
            onClick: (e: MouseEvent<HTMLElement>) => {
              if (l.onHand === 0 || onAControl(e)) return;
              toggle(l.key);
            },
            style: l.onHand > 0 ? { cursor: "pointer" } : undefined,
          })}
          expandable={{
            expandedRowKeys: [...expanded],
            rowExpandable: (l) => l.onHand > 0,
            onExpand: (_, l) => toggle(l.key),
            expandedRowRender: (l) => unitsOf(l),
          }}
          keyboardRows={(l) =>
            t("inventory.openLineAria", "Show the units of {{what}}", {
              what: lineTitle(l),
            })
          }
          // The pager goes back to page one when the question changes, not when
          // the store moves under it — DataTable's docblock on `resetKey`.
          resetKey={`${scope}|${categories.join()}|${bands.join()}`}
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
                    products,
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
              title: t("inventory.unitAndSku", "Unit & SKU"),
              key: "unit",
              // The seven widths and the expand chevron add up to a 1440px
              // laptop screen with the nav open: past that, Unit price and Sell
              // price slide under the pinned Action column. 216 until the
              // chevron arrived (2026-10-02).
              width: 180,
              facet: true,
              facetLabel: t("inventory.anyProduct", "Any product"),
              searchable: true,
              sortValue: (l) => `${l.product} ${l.specs}`,
              // The filter lists products, not variants: eight lines of
              // "MacBook Air M2" differing only in RAM would make a filter
              // nobody can read.
              facetValue: (l) => l.product,
              // A serial is a legitimate way to reach a line — staff paste one
              // in constantly — so the serials ride along in what this column
              // searches without being shown in it.
              searchValue: (l) =>
                `${l.product} ${l.specs} ${l.code} ${l.units
                  .map((u) => u.serial)
                  .join(" ")}`,
              render: (_, l) => (
                <Flex vertical gap={0}>
                  <Typography.Text>
                    <Typography.Text strong>{l.product}</Typography.Text>{" "}
                    {l.specs}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {l.code}
                  </Typography.Text>
                </Flex>
              ),
            },
            {
              title: t("inventory.grade", "Grade"),
              key: "grade",
              // A one-letter tag under a short heading: the 16px Warehouse took
              // comes from here, so the list still fits 1440 with the sider open.
              width: COLUMN.grade - 16,
              facet: true,
              facetLabel: t("inventory.anyGrade", "Any grade"),
              // An empty line has no units and so no grade — not "ungraded".
              facetValue: (l) =>
                l.onHand === 0 ? undefined : gradeLabel(l.grade),
              sortValue: (l) =>
                l.onHand === 0 ? undefined : gradeRank(l.grade),
              render: (_, l) =>
                l.onHand === 0 ? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ) : (
                  <GradeTag grade={l.grade} />
                ),
            },
            {
              title: t("inventory.warehouse", "Warehouse"),
              key: "warehouse",
              // Wide enough for the heading beside its sorter and filter on one
              // line (owner report 2026-10-21: it broke as "Warehous / e").
              width: COLUMN.status,
              // In the header since 2026-09-19: a line is ONE warehouse, so
              // filtering lines by it is filtering units by it, and the
              // quantities beside the filter stay true. See the docblock.
              facet: true,
              facetLabel: t("inventory.anyWarehouse", "Any warehouse"),
              facetValue: (l) => warehouseName(l.locationId),
              sortValue: (l) => warehouseName(l.locationId),
              render: (_, l) =>
                warehouseName(l.locationId) ?? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ),
            },
            {
              /*
               * One quantity, and what it is made of (owner decision
               * 2026-08-26). A bare number over nothing reads as "we hold 3";
               * "3 available" reads as "3 you can sell today", which is the
               * question being asked — so the breakdown is shown even when it
               * is the whole quantity. A line of text rather than four columns:
               * on a normal day three of them would be columns of zeros.
               */
              title: t("inventory.qty", "Qty"),
              key: "qty",
              width: COLUMN.qty,
              align: "right",
              sortValue: (l) => l.onHand,
              render: (_, l) => {
                const parts = [
                  l.available > 0 &&
                    t("inventory.nAvailable", "{{n}} available", {
                      n: l.available,
                    }),
                  l.reserved > 0 &&
                    t("inventory.nOnHold", "{{n}} on hold", { n: l.reserved }),
                  l.qc > 0 && t("inventory.nInQc", "{{n}} in QC", { n: l.qc }),
                  l.service > 0 &&
                    t("inventory.nOnService", "{{n}} on service", {
                      n: l.service,
                    }),
                ].filter(Boolean);
                return (
                  <Flex vertical align="flex-end" gap={2}>
                    <Qty n={l.onHand} strong />
                    {parts.length > 0 && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {parts.join(" · ")}
                      </Typography.Text>
                    )}
                  </Flex>
                );
              },
            },
            {
              /*
               * What the units on the line were bought for — `Unit.buy`, the
               * invoice line, which Inbound calls a unit's "Unit price". The
               * COGS under it adds the invoice's expenses and any repairs, and
               * is drawn only when those make it a different number.
               */
              title: t("inventory.unitPrice", "Unit price"),
              key: "buy",
              width: COLUMN.money,
              align: "right",
              sortValue: (l) => (l.buy.count === 0 ? undefined : l.buy.min),
              render: (_, l) =>
                l.buy.count === 0 ? (
                  <Typography.Text type="secondary">{fmtRp(0)}</Typography.Text>
                ) : (
                  <Flex vertical align="flex-end" gap={0}>
                    <Typography.Text>{rangeText(l.buy)}</Typography.Text>
                    {(l.cost.min !== l.buy.min || l.cost.max !== l.buy.max) && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("inventory.cogsOne", "COGS {{amount}}", {
                          amount: rangeText(l.cost),
                        })}
                      </Typography.Text>
                    )}
                  </Flex>
                ),
            },
            {
              /*
               * What the units on sale ask (per serial since 2026-09-08), and
               * under it the variant's marketplace price — the highest of its
               * units', the same on every line of the variant, because a
               * listing is one price (owner ask 2026-09-19).
               */
              title: t("inventory.sellPrice", "Sell price"),
              key: "sell",
              width: COLUMN.money,
              align: "right",
              sortValue: (l) => (l.store.count === 0 ? undefined : l.store.min),
              render: (_, l) => {
                const market = marketBySku.get(l.skuId);
                return (
                  <Flex vertical align="flex-end" gap={0}>
                    {l.store.count === 0 ? (
                      <Typography.Text type="secondary">
                        {fmtRp(0)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text>{rangeText(l.store)}</Typography.Text>
                    )}
                    {market !== undefined && l.onHand > 0 && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("inventory.marketOne", "marketplace {{price}}", {
                          price: fmtRp(market),
                        })}
                      </Typography.Text>
                    )}
                  </Flex>
                );
              },
            },
            {
              // Titled, as the owner listed it. On a phone that makes it a
              // labelled line of the card rather than the card's foot, which is
              // where its two buttons read best anyway.
              title: t("inventory.action", "Action"),
              key: "actions",
              width: COLUMN.actionsWide,
              fixed: compact ? undefined : "right",
              render: (_, l) => (
                <Flex gap={SPACE.xs} wrap>
                  <Button
                    size="small"
                    icon={<TagsOutlined />}
                    disabled={l.units.length === 0}
                    // The visible words first, so the name a screen reader
                    // announces contains what a sighted user reads (WCAG 2.5.3).
                    aria-label={t(
                      "inventory.setPriceFor",
                      "Set price for {{what}}",
                      {
                        what: lineTitle(l),
                      },
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRepricing({ title: lineTitle(l), units: l.units });
                    }}
                  >
                    {t("inventory.setPrice", "Set price")}
                  </Button>
                  <Button
                    size="small"
                    icon={<PrinterOutlined />}
                    disabled={l.units.length === 0}
                    aria-label={t(
                      "inventory.printBarcodeFor",
                      "Print barcode for {{what}}",
                      { what: lineTitle(l) },
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrinting(labelsFor(l.units, db.skus, db.models));
                    }}
                  >
                    {t("inventory.printBarcode", "Print barcode")}
                  </Button>
                </Flex>
              ),
            },
          ]}
        />
      </div>

      <SendToServiceModal
        serial={servicing}
        raisedBy="ADJUSTMENT"
        onClose={() => setServicing(null)}
      />

      <SupplierReturnModal
        serial={returning}
        onClose={() => setReturning(null)}
      />

      <UnitEditModal
        open={editingUnit !== null}
        unit={editingUnit}
        onClose={() => setEditingUnit(null)}
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
        costOf={costOf}
        listedUnits={db.units}
        skuName={(skuId) => {
          const sku = db.skus.find((s) => s.id === skuId);
          return sku ? `${sku.name} ${sku.variantLabel}` : skuId;
        }}
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
