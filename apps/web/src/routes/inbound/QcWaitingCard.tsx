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
 * supplier's invoice number and the rows are that invoice's units. A row
 * opens the invoice, where the grading happens.
 *
 * Above the invoice list because it is work outstanding and the list is a
 * record — `OrphanQcCard`'s reason. Renders nothing when nothing is waiting.
 * `lib/qcWaiting.ts` decides what waits.
 */
import { Card, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import { fmtDate, fmtNone } from "../../lib/format.js";
import type { QcWaitingRow } from "../../lib/qcWaiting.js";
import { COLUMN } from "../../theme/tokens";

/** Fits `PI-2026/10-000004` in bold on one line, with the cell's padding. */
const INVOICE_CODE_WIDTH = 200;
/** A product name and its variant line wrap; this is a floor, not a cap. */
const PRODUCT_WIDTH = 240;
export function QcWaitingCard({ rows }: { readonly rows: QcWaitingRow[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (rows.length === 0) return null;

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
      <ProTable<QcWaitingRow>
        persistKey="inbound.qcWaiting"
        rowKey="key"
        dataSource={rows}
        searchPlaceholder={t(
          "qcWaiting.search",
          "Search product, SKU code, serial, order or invoice number",
        )}
        // Named by the unit as well as the order: one invoice can have a
        // dozen rows here, and the invoice list below names the order alone.
        keyboardRows={(r) =>
          t("qcWaiting.openRow", "Open {{code}} for {{unit}}", {
            code: r.poCode,
            unit: r.serial ?? (r.product || fmtNone()),
          })
        }
        onRow={(r) => ({
          style: { cursor: "pointer" },
          onClick: () => navigate(`/inbound/${r.poId}`),
        })}
        columns={[
          {
            title: t("qcWaiting.product", "Product"),
            dataIndex: "product",
            width: PRODUCT_WIDTH,
            searchable: true,
            facet: true,
            facetValue: (r) => r.product || fmtNone(),
            searchValue: (r) => `${r.product} ${r.variant} ${r.skuCode}`,
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
            title: t("qcWaiting.serial", "Serial"),
            dataIndex: "serial",
            width: COLUMN.serial,
            searchable: true,
            searchValue: (r) => r.serial ?? "",
            render: (_: unknown, r) =>
              r.serial === null ? (
                <Typography.Text type="secondary">
                  {t("qcWaiting.noSerialYet", "No serial yet")}
                </Typography.Text>
              ) : (
                <Typography.Text code>{r.serial}</Typography.Text>
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
        ]}
      />
    </Card>
  );
}
