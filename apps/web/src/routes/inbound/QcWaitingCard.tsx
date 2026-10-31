/**
 * Waiting for QC, on `/inbound` — every unit the bench still owes a grade,
 * across every invoice (owner ask 2026-10-26).
 *
 * > *"They will see one unit that is in the store and that is left, but they
 * > might not know which invoice it is from … They will see the invoice list,
 * > and see what units are left, and look for that unit."*
 *
 * Both searches are this one box: type a product (or its SKU code, or a
 * serial) and the rows say which invoice each unit is on; type an order or a
 * supplier's invoice number and the rows are that invoice's units.
 *
 * ## One row per product of an invoice, with its Qty (owner ask 2026-10-31)
 *
 * > *"Add the QTY, when they want to QC that, they can click a button and open
 * > and grade it, they can do it multiple unit if the qty is more than 1 …
 * > without opening the actual QC page."*
 *
 * A delivery of six of one Air was six identical rows. Now it is one, and its
 * *QC* button (or a click on the row) opens those six units' popup right here
 * — the invoice page's own popup drawn alone (`InboundDetailPage`'s
 * `embedded`), so the serial rules, the battery, the description, the grade
 * and the Accept / Service / Return decisions are the bench's, unchanged.
 *
 * Above the invoice list because it is work outstanding and the list is a
 * record — `OrphanQcCard`'s reason. Renders nothing when nothing is waiting.
 * `lib/qcWaiting.ts` decides what waits.
 */
import { useMemo, useState } from "react";
import { Button, Card, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import { fmtDate, fmtNone } from "../../lib/format.js";
import type { QcWaitingRow } from "../../lib/qcWaiting.js";
import { COLUMN } from "../../theme/tokens";
import { InboundDetailPage } from "./InboundDetailPage";

/** Fits `PI-2026/10-000004` in bold on one line, with the cell's padding. */
const INVOICE_CODE_WIDTH = 200;
/** A product name and its variant line wrap; this is a floor, not a cap. */
const PRODUCT_WIDTH = 240;

/** One product of one invoice, and every unit of it still waiting. */
interface QcGroupRow {
  readonly key: string;
  readonly poId: string;
  readonly poCode: string;
  readonly invoice: string | null;
  readonly supplier: string;
  readonly product: string;
  readonly variant: string;
  readonly skuCode: string;
  /** Units in hand, waiting for a grade. */
  readonly serials: readonly string[];
  /** Slots nobody has scanned a serial into yet. */
  readonly rowKeys: readonly string[];
  readonly qty: number;
  /** The earliest arrival in the group. */
  readonly arrivedAt: string;
  /** The longest wait in the group. */
  readonly days: number;
}

/** Folds the unit-by-unit list into one row per invoice × product. */
export function groupQcWaiting(rows: readonly QcWaitingRow[]): QcGroupRow[] {
  const groups = new Map<string, QcGroupRow>();
  for (const r of rows) {
    const key = `${r.poId}|${r.skuId}`;
    const g = groups.get(key);
    const serials = r.serial === null ? [] : [r.serial];
    const rowKeys = r.serial === null && r.rowKey ? [r.rowKey] : [];
    if (g === undefined) {
      groups.set(key, {
        key,
        poId: r.poId,
        poCode: r.poCode,
        invoice: r.invoice,
        supplier: r.supplier,
        product: r.product,
        variant: r.variant,
        skuCode: r.skuCode,
        serials,
        rowKeys,
        qty: 1,
        arrivedAt: r.arrivedAt,
        days: r.days,
      });
      continue;
    }
    groups.set(key, {
      ...g,
      serials: [...g.serials, ...serials],
      rowKeys: [...g.rowKeys, ...rowKeys],
      qty: g.qty + 1,
      arrivedAt:
        g.arrivedAt === "" || (r.arrivedAt !== "" && r.arrivedAt < g.arrivedAt)
          ? r.arrivedAt
          : g.arrivedAt,
      days: Math.max(g.days, r.days),
    });
  }
  return [...groups.values()];
}

export function QcWaitingCard({ rows }: { readonly rows: QcWaitingRow[] }) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupQcWaiting(rows), [rows]);
  /**
   * The group whose units are open, or null. Held as a snapshot: a unit
   * accepted in the popup leaves the list, and must not leave the popup.
   */
  const [opened, setOpened] = useState<QcGroupRow | null>(null);
  if (rows.length === 0 && opened === null) return null;

  const secondary = (text: string) => (
    <Typography.Text
      type="secondary"
      style={{ display: "block", fontSize: 12 }}
    >
      {text}
    </Typography.Text>
  );

  return (
    <Card
      title={t("qcWaiting.title", "Waiting for QC ({{count}})", {
        count: rows.length,
      })}
      style={{ marginBottom: 16 }}
    >
      <ProTable<QcGroupRow>
        persistKey="inbound.qcWaiting"
        rowKey="key"
        dataSource={groups}
        searchPlaceholder={t(
          "qcWaiting.search",
          "Search product, SKU code, serial, order or invoice number",
        )}
        keyboardRows={(r) =>
          t("qcWaiting.openGroup", "QC {{product}} on {{code}}", {
            code: r.poCode,
            product: r.product || fmtNone(),
          })
        }
        onRow={(r) => ({
          style: { cursor: "pointer" },
          onClick: () => setOpened(r),
        })}
        columns={[
          {
            title: t("qcWaiting.product", "Product"),
            dataIndex: "product",
            width: PRODUCT_WIDTH,
            searchable: true,
            facet: true,
            facetValue: (r) => r.product || fmtNone(),
            // A serial finds the row it is on.
            searchValue: (r) =>
              `${r.product} ${r.variant} ${r.skuCode} ${r.serials.join(" ")}`,
            sortValue: (r) => r.product,
            render: (_: unknown, r) => (
              <>
                <Typography.Text>{r.product || fmtNone()}</Typography.Text>
                {secondary(
                  [r.variant, r.skuCode].filter((s) => s !== "").join(" · "),
                )}
              </>
            ),
          },
          {
            title: t("qcWaiting.qty", "Qty"),
            dataIndex: "qty",
            width: COLUMN.qty,
            align: "right",
            sortValue: (r) => r.qty,
            render: (_: unknown, r) => (
              <>
                <Typography.Text strong>{r.qty}</Typography.Text>
                {r.rowKeys.length > 0 &&
                  secondary(
                    t("qcWaiting.noSerialCount", "{{count}} no serial", {
                      count: r.rowKeys.length,
                    }),
                  )}
              </>
            ),
          },
          {
            title: t("qcWaiting.invoice", "Invoice"),
            dataIndex: "poCode",
            // A real code is `PI-2026/10-000004` — six digits, in bold — which
            // COLUMN.code (sized for four) broke at its hyphen. Kept on one
            // line; the product name, which wraps happily, gives up the room.
            width: INVOICE_CODE_WIDTH,
            searchable: true,
            searchValue: (r) => `${r.poCode} ${r.invoice ?? ""}`,
            sortValue: (r) => r.poCode,
            render: (_: unknown, r) => (
              <>
                <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                  {r.poCode}
                </Typography.Text>
                {secondary(
                  r.invoice ?? t("inboundList.noInvoice", "No invoice"),
                )}
              </>
            ),
          },
          {
            title: t("qcWaiting.supplier", "Supplier"),
            dataIndex: "supplier",
            facet: true,
            facetValue: (r) => r.supplier || fmtNone(),
            render: (_: unknown, r) => r.supplier || fmtNone(),
          },
          {
            title: t("qcWaiting.arrived", "Arrived"),
            dataIndex: "arrivedAt",
            width: COLUMN.date,
            sortValue: (r) => r.arrivedAt,
            render: (_: unknown, r) =>
              r.arrivedAt === "" ? fmtNone() : fmtDate(r.arrivedAt),
          },
          {
            title: t("qcWaiting.daysWaiting", "Days waiting"),
            dataIndex: "days",
            width: COLUMN.qty,
            align: "right",
            sortValue: (r) => r.days,
            defaultSortOrder: "descend",
          },
          {
            title: "",
            key: "qc",
            width: COLUMN.status,
            align: "right",
            render: (_: unknown, r) => (
              <Button
                type="primary"
                size="small"
                aria-label={t(
                  "qcWaiting.qcAria",
                  "QC {{count}} × {{product}}",
                  {
                    count: r.qty,
                    product: r.product || fmtNone(),
                  },
                )}
                onClick={(e) => {
                  // The row opens the same thing; once is enough.
                  e.stopPropagation();
                  setOpened(r);
                }}
              >
                {t("qcWaiting.qcButton", "QC ({{count}})", { count: r.qty })}
              </Button>
            ),
          },
        ]}
      />
      {opened !== null && (
        <InboundDetailPage
          // A fresh popup per group: its drafts and dialogs are its own.
          key={opened.key}
          embedded={{
            poId: opened.poId,
            rowKeys: opened.rowKeys,
            serials: opened.serials,
            onClose: () => setOpened(null),
          }}
        />
      )}
    </Card>
  );
}
