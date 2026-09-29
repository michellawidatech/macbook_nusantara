/**
 * The invoice's lines: product, quantity, price, discount, total, COGS
 * (owner ask 2026-09-20).
 *
 * > *"Input product name > QTY > price > discount > display total (+ COGS
 * > based on the tax + shipping fee displayed before). When the user clicks
 * > tab, then it will display a modal popup for the user to fill: Serial,
 * > grade, battery, sell price."*
 *
 * Drawn on BOTH inbound screens, because the owner asked for exactly that:
 * *"either seeing inbound detail and adding new inbound will have the same
 * display for the unit and it should only have that."* The order form fills
 * it from its own drafts; the order's page fills it from the invoice, and
 * each answers back through its own callbacks.
 *
 * It REPLACES two things on the order page — the collapsed *Inbound* section
 * and the list of one row per unit — and the discrepancy panel that sat under
 * them went with it (*"changed product no need to flag"*). Correcting the
 * invoice is what this table is; the popup behind each line is where the
 * units are.
 *
 * ## Two marks, two colours (owner ask 2026-09-24)
 *
 * A line the shop took in that the supplier never billed is **yellow**
 * (`PoItem.outsideInvoice`, added from *Add outside invoice* below the table);
 * a line with pieces that never turned up is **red**. Red wins where a line is
 * both. Neither changes the money — see `PurchaseLine.outsideInvoice` — and
 * what they are FOR is the list under the table, which is the same two facts
 * gathered where somebody chasing a supplier can read them at once.
 *
 * ## Tab is the way in
 *
 * Tab off the discount box opens the line's popup, so the whole line can be
 * entered from the keyboard without reaching for a button: product, qty,
 * price, discount, ⇥, serials. The button is drawn all the same, because a
 * keyboard affordance nobody can see is a feature for the person who wrote
 * it.
 */
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Flex, Tooltip, Typography } from "antd";
import { InboxOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { EditableTable } from "../../components/EditableTable";
import { SkuPicker, skuFullName } from "../../components/SkuPicker";
import { CountInput } from "../../components/CountInput";
import { CommitMoneyInput } from "../../components/CommitMoneyInput";
import { fmtRp, fmtNone } from "../../lib/format.js";
import { priceRange } from "../../lib/unitPrice.js";
import type { PurchaseLine } from "../../lib/invoiceLines.js";
import type { Sku } from "../../mock/seed.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

/** The DOM id of a line's price box — where adding a line puts the caret. */
export const lineCostFieldId = (key: string) => `po-line-cost-${key}`;
/** The DOM id of a line's discount box — the one Tab leaves for the popup. */
const lineDiscountFieldId = (key: string) => `po-line-discount-${key}`;
/** The DOM id of a counted line's sell-price box. */
const lineSellFieldId = (key: string) => `po-line-sell-${key}`;

/**
 * One width for every box (owner ask 2026-09-24: *"every input field will
 * have the same size and is in 1 row"*). Qty, Unit price, Discount and Sell
 * price are columns of this width and each box fills its column; the two
 * money figures the table only PRINTS share a narrower one. Every column is
 * declared, so `EditableTable` lays the grid out at their sum and nothing is
 * squeezed, and the boxes stand on one line at the top of the row
 * (`.purchase-lines` in global.css) — the product's name and a line's
 * "n received" sit under theirs.
 */
/*
 * Each the least its content needs (owner ask 2026-09-28: *"make the table
 * more compact and each column only have width that are necessary"*), summed
 * to 1120 — what a 1440 screen leaves the Units card beside an open sider —
 * so the row fits there and scrolls only on a narrower screen or at a higher
 * zoom. A box is `Rp 120.000.000` at the small input size plus this table's
 * 6px cell padding (`.purchase-lines` in global.css); a printed figure is `Rp 36.471.427`. Wider screens spread the
 * surplus over every column in proportion.
 */
const INPUT_COLUMN_WIDTH = 132;
/*
 * Wide enough for the whole shop code in the picker's box (owner report
 * 2026-09-29: `AIR 13" 2020…` cut off). The box is an `<input>` and cannot
 * wrap, so the column has to fit the code; the model name under it still
 * wraps. This lifts the sum to 1216, so at 1440 with the sider open the row
 * now scrolls a little — the name being readable was the owner's call.
 */
const PRODUCT_COLUMN_WIDTH = 248;
const MONEY_COLUMN_WIDTH = 112;
const NUMBER_COLUMN_WIDTH = 32;
/** "Lihat semua unit (12/12)" — the Indonesian is the longer label. */
const UNITS_COLUMN_WIDTH = 184;
/** The row's own buttons, when a screen passes any: it says how wide. */
const ACTIONS_COLUMN_WIDTH = COLUMN.actions;

/** What the table paints a row: red for missing, yellow for unbilled. */
export function purchaseLineClass(l: PurchaseLine): string {
  if (l.notArrived > 0) return "row-not-arrived";
  return l.outsideInvoice ? "row-outside-invoice" : "";
}

export interface PurchaseLinesTableProps {
  readonly lines: readonly PurchaseLine[];
  readonly skus: readonly Sku[];
  /** A closed invoice shows its lines and takes no edits. */
  readonly closed?: boolean;
  /** What one line's units cost all in — price, discount and its share of
   *  the invoice's expenses. Whole-line figure, not per piece. */
  readonly cogsOf: (line: PurchaseLine) => number;
  readonly onSetProduct: (line: PurchaseLine, skuId: string) => void;
  readonly onSetQty: (line: PurchaseLine, qty: number) => void;
  readonly onSetCost: (line: PurchaseLine, value: number | null) => void;
  readonly onSetDiscount: (line: PurchaseLine, value: number | null) => void;
  /** Open the line's units. Omitted for a counted product, which has none. */
  readonly onOpenDetails: (line: PurchaseLine) => void;
  /**
   * A counted product's sell price — the variant's asking price, the one
   * price an accessory has and what the till quotes for it (owner ask
   * 2026-09-24: *"the accessories at the moment do not have a field to input
   * the price"*). Drawn in the Sell price column, where a tracked line only
   * reads what its units ask. Left out, a counted line's cell stays empty.
   */
  readonly sellPriceOf?: (line: PurchaseLine) => number;
  readonly onSetSellPrice?: (line: PurchaseLine, value: number | null) => void;
  /** The line's own buttons — not arrived, remove, whatever the page offers. */
  readonly actions?: (line: PurchaseLine) => ReactNode;
  /** How wide `actions` needs — one icon is not a labelled button and two. */
  readonly actionsWidth?: number;
  /** A blank line at the end, for the page that lets one be added. */
  readonly onAddLine?: () => void;
  readonly emptyText?: ReactNode;
}

/** A map without one key. */
function drop<T>(
  map: Readonly<Record<string, T>>,
  key: string,
): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** Tab forward, with none of the modifiers other keys own. */
const plainTab = (e: KeyboardEvent<HTMLElement>) =>
  e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;

export function PurchaseLinesTable({
  lines,
  skus,
  closed = false,
  cogsOf,
  onSetProduct,
  onSetQty,
  onSetCost,
  onSetDiscount,
  onOpenDetails,
  sellPriceOf,
  onSetSellPrice,
  actions,
  actionsWidth,
  onAddLine,
  emptyText,
}: PurchaseLinesTableProps) {
  const { t } = useTranslation();
  /** A figure being typed — written when its box is left. */
  const [qtyDraft, setQtyDraft] = useState<Record<string, number | null>>({});
  const [costDraft, setCostDraft] = useState<Record<string, number | null>>({});
  const [discDraft, setDiscDraft] = useState<Record<string, number | null>>({});
  const [sellDraft, setSellDraft] = useState<Record<string, number | null>>({});

  const productName = (skuId: string) => {
    const sku = skus.find((s) => s.id === skuId);
    return sku ? `${sku.code} — ${skuFullName(sku)}` : fmtNone();
  };

  const commitQty = (l: PurchaseLine) => {
    const typed = qtyDraft[l.key];
    setQtyDraft((d) => drop(d, l.key));
    if (typed === undefined || typed === null) return;
    const qty = Math.max(1, Math.floor(typed));
    if (qty !== l.qty) onSetQty(l, qty);
  };

  /**
   * The Sell price column (owner ask 2026-09-24). A counted product's is the
   * variant's asking price — the one price an accessory has — and it is a
   * box, amber while it is nothing: the order page will not confirm the
   * pieces into stock until it is set, because the till would quote Rp 0 for
   * them. A tracked line's units are priced one by one in the popup, so its
   * cell only reads what they ask: one figure, a range, or None.
   */
  const sellPriceCell = (l: PurchaseLine) => {
    if (!l.counted) {
      const asked = l.units
        .map((u) => u.row.unit?.price)
        .filter((p): p is number => typeof p === "number" && p > 0);
      const range = priceRange(asked);
      return (
        <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
          {range.count === 0
            ? fmtNone()
            : range.single
              ? fmtRp(range.min)
              : `${fmtRp(range.min)} – ${fmtRp(range.max)}`}
        </Typography.Text>
      );
    }
    if (sellPriceOf === undefined || l.skuId === "") return null;
    const current = sellPriceOf(l);
    if (closed) return fmtRp(current);
    const typed = sellDraft[l.key];
    const value = typed !== undefined ? typed : current;
    return (
      <CommitMoneyInput
        id={lineSellFieldId(l.key)}
        label={t("inbound.sellPriceOfLine", "Sell price of {{product}}", {
          product: productName(l.skuId),
        })}
        placeholder={t("inbound.sellPrice", "Sell price")}
        value={value}
        warn={!value}
        onChange={(v) => setSellDraft((d) => ({ ...d, [l.key]: v }))}
        onCommit={(v) => {
          setSellDraft((d) => drop(d, l.key));
          onSetSellPrice?.(l, v);
        }}
      />
    );
  };

  const columns = [
    {
      title: "#",
      key: "n",
      width: NUMBER_COLUMN_WIDTH,
      responsive: ["md" as const],
      render: (_: unknown, __: PurchaseLine, i: number) => (
        <Typography.Text type="secondary">{i + 1}</Typography.Text>
      ),
    },
    {
      title: t("inbound.unitCol", "Unit"),
      key: "product",
      // A product label runs to seventy characters; it wraps in its own cell
      // rather than taking the money columns' room.
      width: PRODUCT_COLUMN_WIDTH,
      render: (_: unknown, l: PurchaseLine) =>
        closed ? (
          <Typography.Text>{productName(l.skuId)}</Typography.Text>
        ) : (
          <SkuPicker
            skus={skus}
            value={l.skuId || undefined}
            placeholder={t(
              "inbound.pickProduct",
              "Search a product name or SKU code",
            )}
            status={l.skuId === "" ? "warning" : undefined}
            aria-label={t("inbound.product", "Product")}
            onChange={(v) => {
              if (v && v !== l.skuId) onSetProduct(l, v);
            }}
          />
        ),
    },
    {
      title: t("inbound.qty", "Qty"),
      key: "qty",
      width: INPUT_COLUMN_WIDTH,
      render: (_: unknown, l: PurchaseLine) => (
        <Flex vertical gap={2}>
          {closed ? (
            <Typography.Text>{l.qty}</Typography.Text>
          ) : (
            <CountInput
              min={1}
              precision={0}
              style={{ width: "100%" }}
              aria-label={t("inbound.qty", "Qty")}
              value={qtyDraft[l.key] !== undefined ? qtyDraft[l.key] : l.qty}
              onChange={(v) => setQtyDraft((d) => ({ ...d, [l.key]: v }))}
              onBlur={() => commitQty(l)}
              onPressEnter={() => commitQty(l)}
            />
          )}
          {(l.received > 0 || l.notArrived > 0) && (
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {[
                l.received > 0
                  ? l.counted
                    ? t("inbound.invoiceArrived", "{{count}} arrived", {
                        count: l.received,
                      })
                    : t("inbound.invoiceReceived", "{{count}} received", {
                        count: l.received,
                      })
                  : null,
                l.notArrived > 0
                  ? t("inbound.notArrivedCount", "{{count}} not arrived", {
                      count: l.notArrived,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: t("inbound.unitPrice", "Unit price"),
      key: "cost",
      width: INPUT_COLUMN_WIDTH,
      render: (_: unknown, l: PurchaseLine) => {
        if (closed) return fmtRp(l.unitCost);
        const typed = costDraft[l.key];
        const value = typed !== undefined ? typed : l.unitCost;
        return (
          <CommitMoneyInput
            id={lineCostFieldId(l.key)}
            label={t("inbound.unitPriceOfLine", "Unit price of {{product}}", {
              product: productName(l.skuId),
            })}
            value={value}
            warn={value === 0}
            onChange={(v) => setCostDraft((d) => ({ ...d, [l.key]: v }))}
            onCommit={(v) => {
              setCostDraft((d) => drop(d, l.key));
              onSetCost(l, v);
            }}
          />
        );
      },
    },
    {
      title: t("inbound.lineDiscount", "Discount"),
      key: "discount",
      width: INPUT_COLUMN_WIDTH,
      render: (_: unknown, l: PurchaseLine) => {
        if (closed)
          return l.discount === 0 ? (
            <Typography.Text type="secondary">{fmtRp(0)}</Typography.Text>
          ) : (
            fmtRp(l.discount)
          );
        const typed = discDraft[l.key];
        const value = typed !== undefined ? typed : l.discount;
        return (
          <div
            // Tab out of the last money box is what opens the units (owner ask
            // 2026-09-20). Captured on the wrapper so the box keeps its own
            // blur-commit: the value is written, then the popup opens.
            onKeyDown={(e) => {
              if (!plainTab(e) || l.counted) return;
              e.preventDefault();
              setDiscDraft((d) => drop(d, l.key));
              onSetDiscount(l, value);
              onOpenDetails(l);
            }}
          >
            <CommitMoneyInput
              id={lineDiscountFieldId(l.key)}
              label={t("inbound.lineDiscountOf", "Discount on {{product}}", {
                product: productName(l.skuId),
              })}
              value={value}
              onChange={(v) => setDiscDraft((d) => ({ ...d, [l.key]: v }))}
              onCommit={(v) => {
                setDiscDraft((d) => drop(d, l.key));
                onSetDiscount(l, v);
              }}
            />
          </div>
        );
      },
    },
    {
      title: t("inbound.sellPrice", "Sell price"),
      key: "sell",
      width: INPUT_COLUMN_WIDTH,
      render: (_: unknown, l: PurchaseLine) => sellPriceCell(l),
    },
    {
      title: t("inbound.total", "Total"),
      key: "total",
      width: MONEY_COLUMN_WIDTH,
      align: "right" as const,
      // What is owed for the line and — when part of it never came — what the
      // supplier billed, so units that never arrived do not read as free.
      render: (_: unknown, l: PurchaseLine) =>
        l.invoiced === l.total ? (
          fmtRp(l.total)
        ) : (
          <Flex vertical align="end">
            <span>{fmtRp(l.total)}</span>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("inbound.invoiceBilled", "{{amount}} billed", {
                amount: fmtRp(l.invoiced),
              })}
            </Typography.Text>
          </Flex>
        ),
    },
    {
      title: t("inbound.cogs", "COGS"),
      key: "cogs",
      width: MONEY_COLUMN_WIDTH,
      align: "right" as const,
      render: (_: unknown, l: PurchaseLine) => (
        <Tooltip
          title={t(
            "inbound.lineCogsHint",
            "The line total plus its share of this invoice's shipping, tax and other expenses.",
          )}
        >
          <Typography.Text style={{ whiteSpace: "nowrap" }}>
            {fmtRp(cogsOf(l))}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "units",
      width: UNITS_COLUMN_WIDTH,
      align: "right" as const,
      // At the end of the row, reachable without scrolling because the row
      // now fits the screen (owner ask 2026-09-28) rather than because the
      // button moved.
      render: (_: unknown, l: PurchaseLine) =>
        l.counted ? null : (
          <Button
            size="small"
            disabled={l.skuId === ""}
            onClick={() => onOpenDetails(l)}
            aria-label={t(
              "inbound.openDetailsAria",
              "Serials and QC for {{product}}",
              { product: productName(l.skuId) },
            )}
          >
            {t("inbound.openDetails", "See all units ({{done}}/{{total}})", {
              done: l.received,
              total: l.qty,
            })}
          </Button>
        ),
    },
    ...(actions
      ? [
          {
            title: "",
            key: "actions",
            width: actionsWidth ?? ACTIONS_COLUMN_WIDTH,
            align: "right" as const,
            render: (_: unknown, l: PurchaseLine) => (
              <Flex gap={SPACE.xs} justify="end" align="center" wrap>
                {actions?.(l)}
              </Flex>
            ),
          },
        ]
      : []),
  ];

  return (
    <EditableTable<PurchaseLine>
      size="small"
      rowKey="key"
      className="qc-table purchase-lines"
      rowClassName={purchaseLineClass}
      dataSource={lines}
      rowTitle={(l) => productName(l.skuId)}
      emptyText={
        emptyText ??
        t(
          "inbound.invoiceNoLines",
          "Nothing on this invoice yet. Add each product the supplier billed below.",
        )
      }
      {...(onAddLine && !closed
        ? {
            onAdd: onAddLine,
            addLabel: t("inbound.addLine", "Add a product"),
          }
        : {})}
      columns={columns}
    />
  );
}

/**
 * A product and how many — the one way lines get onto an invoice.
 *
 * Lifted out of the retired *Inbound* section (2026-09-20) unchanged in
 * behaviour but not in effect: it used to add `qty` separate rows, one per
 * unit, and now it adds ONE line of that quantity — *"it will not
 * automatically expand the unit below it."*
 */
export function AddLineBar({
  skus,
  onAdd,
  ariaLabel,
  qtyAriaLabel,
  hint,
  outsideInvoice = false,
}: {
  readonly skus: readonly Sku[];
  readonly onAdd: (
    skuId: string,
    qty: number,
    /** True from *Add outside invoice* — the supplier never billed it. */
    outsideInvoice: boolean,
  ) => void;
  /** Different per bar, so two on one page are two named fields. */
  readonly ariaLabel: string;
  readonly qtyAriaLabel: string;
  readonly hint: string;
  /**
   * Draw the second button (owner ask 2026-09-24: *"when adding a product,
   * add a button called 'Add outside invoice' … and mark that row as
   * yellow"*). Off on the order FORM, where the invoice is being typed in for
   * the first time and everything on it is by definition on it.
   */
  readonly outsideInvoice?: boolean;
}) {
  const { t } = useTranslation();
  const [addSku, setAddSku] = useState<string | undefined>();
  const [addQty, setAddQty] = useState<number | null>(1);

  const add = (outside: boolean) => {
    if (!addSku) return;
    onAdd(addSku, Math.max(1, Math.floor(addQty ?? 1)), outside);
    setAddSku(undefined);
    setAddQty(1);
  };

  return (
    <Flex vertical gap={SPACE.xs}>
      <Flex gap={SPACE.sm} wrap align="flex-start">
        <div style={{ flex: "2 1 280px", minWidth: 0 }}>
          <SkuPicker
            skus={skus}
            value={addSku}
            onChange={setAddSku}
            aria-label={ariaLabel}
            placeholder={t(
              "inbound.pickProduct",
              "Search a product name or SKU code",
            )}
          />
        </div>
        <CountInput
          min={1}
          precision={0}
          value={addQty}
          onChange={setAddQty}
          aria-label={qtyAriaLabel}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            add(false);
          }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined aria-hidden />}
          disabled={!addSku || !((addQty ?? 0) >= 1)}
          onClick={() => add(false)}
        >
          {t("inbound.addLineOf", "Add {{count}} unit(s)", {
            count: Math.max(1, Math.floor(addQty ?? 1)),
          })}
        </Button>
        {outsideInvoice && (
          <Tooltip
            title={t(
              "inbound.addOutsideHint",
              "The shop took these in and the supplier's paper never billed them. The row is marked yellow; what they cost is unchanged.",
            )}
          >
            <Button
              icon={<InboxOutlined aria-hidden />}
              disabled={!addSku || !((addQty ?? 0) >= 1)}
              onClick={() => add(true)}
            >
              {t("inbound.addOutside", "Add outside invoice")}
            </Button>
          </Tooltip>
        )}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
        {hint}
      </Typography.Text>
    </Flex>
  );
}

/**
 * What did not go to plan on this delivery, under the table (owner ask
 * 2026-09-24).
 *
 * > *"Then on the bottom of the Unit section, make a section to list all the
 * > unit that arrived outside the invoice and not arrived. Show the unit only
 * > and not the serial."*
 *
 * Two short lists, in the colours their rows carry above: the products the
 * supplier billed and never sent, and the products that turned up unbilled.
 * Product and a count — **no serials**, which is the point of the ask: this is
 * the paragraph somebody reads down the telephone to a supplier, and a serial
 * is an answer to a different question. Nothing is drawn when both are empty,
 * which is every ordinary delivery.
 */
export function InvoiceExceptions({
  lines,
  skus,
}: {
  readonly lines: readonly PurchaseLine[];
  readonly skus: readonly Sku[];
}) {
  const { t } = useTranslation();
  const name = (skuId: string) => {
    const sku = skus.find((s) => s.id === skuId);
    return sku
      ? skuFullName(sku)
      : t("inbound.noProductYet", "the unpicked lines");
  };
  const missing = lines.filter((l) => l.notArrived > 0);
  // A line whose pieces never came is already in the list above it; listing it
  // twice would say the supplier both over- and under-sent one product.
  const unbilled = lines.filter((l) => l.outsideInvoice && l.notArrived === 0);
  if (missing.length === 0 && unbilled.length === 0) return null;

  const list = (
    title: string,
    rows: readonly PurchaseLine[],
    count: (l: PurchaseLine) => number,
    dot: string,
  ) =>
    rows.length === 0 ? null : (
      <Flex vertical gap={2} style={{ flex: "1 1 280px", minWidth: 0 }}>
        <Typography.Text strong style={{ fontSize: TYPE.sm }}>
          <span aria-hidden style={{ color: dot }}>
            ●
          </span>{" "}
          {title}
        </Typography.Text>
        {rows.map((l) => (
          <Typography.Text key={l.key} type="secondary">
            {t("inbound.exceptionLine", "{{count}} × {{product}}", {
              count: count(l),
              product: name(l.skuId),
            })}
          </Typography.Text>
        ))}
      </Flex>
    );

  return (
    <Flex gap={SPACE.lg} wrap>
      {list(
        t("inbound.notArrivedSection", "Billed and never arrived"),
        missing,
        (l) => l.notArrived,
        "var(--nusantara-error, #ff4d4f)",
      )}
      {list(
        t("inbound.outsideSection", "Arrived outside the invoice"),
        unbilled,
        (l) => l.qty,
        "var(--nusantara-warning, #faad14)",
      )}
    </Flex>
  );
}
