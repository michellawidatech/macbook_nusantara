/**
 * Receivable and Payable — two leaves of Financial & Report (owner ask
 * 2026-09-22), each one flat table, one row per document.
 *
 * > *"The receivable and the payable supposed to be different navigation tab
 * > and add select/sort per column (select by customer name, date range, phone
 * > number, transaction ID) for receivable, (select by supplier, date range,
 * > inbound number). For each table, provide an action button to record
 * > payment/income … In each table, add a button to add payment."*
 *
 * They were two tabs of one page for a day (2026-09-21, evening), which is
 * one click between a person and the list they came for; `/finance/payable-
 * receivable` still resolves, to Receivable. Every filter is in the column
 * header, as everywhere in the app — `ProTable`'s facets for names and codes,
 * and its `dateRange` for the date.
 *
 * Both buttons open `DebtPaymentModal`. A row's *Record payment* opens it on
 * that party with that document ticked; *Add payment* opens it on nobody.
 *
 * The rows still come out of `lib/payableReceivable.ts` where a test can read
 * them; this file concatenates each group's rows and draws them.
 */
import { useMemo, useState } from "react";
import { Button, Flex, Space, Tag, Typography } from "antd";
import {
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import {
  payableGroups,
  receivableGroups,
  totalOwed,
  type PayableRow,
  type ReceivableRow,
} from "../../lib/payableReceivable.js";
import { useDb } from "../../mock/store.js";
import { exportPdf, exportXlsx } from "../../lib/tableExport.js";
import { SPACE, TYPE } from "../../theme/tokens";
import type { Order } from "../../mock/seed.js";
import {
  DebtPaymentModal,
  RecordPaymentButton,
  type DebtPaymentTarget,
} from "./DebtPaymentModal";

/** Red money — every "Owed" cell shows in this colour (owner ask 2026-09-21). */
const OWED_COLOUR = "#cf1322";

/** A file-name stamp — the shop cares which day the export was pulled. */
const stamp = (now: Date) => now.toISOString().slice(0, 10);

/** What a page says it is owed or owes, beside its button. */
function OwedFigure({ label, total }: { label: string; total: number }) {
  return (
    <Typography.Text>
      {label}{" "}
      <Typography.Text strong style={{ color: OWED_COLOUR }}>
        {fmtRp(total)}
      </Typography.Text>
    </Typography.Text>
  );
}

export function ReceivablePage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const walkIn = t("utang.walkIn", "Walk-in customers");
  const rows = useMemo(
    () =>
      receivableGroups(db.orders, db.customers, walkIn).flatMap((g) => g.rows),
    [db.orders, db.customers, walkIn],
  );
  const total = totalOwed(rows.map((r) => ({ owed: r.owed })));
  /** The sale a "View invoice" button opens on. Null keeps the modal closed. */
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState<DebtPaymentTarget | null>(null);

  return (
    <PageContainer title={t("Receivable", "Receivable")}>
      <InvoiceModal
        db={openOrder ? db : undefined}
        order={openOrder ?? undefined}
        open={openOrder !== null}
        onClose={() => setOpenOrder(null)}
      />
      <DebtPaymentModal
        side="RECEIVABLE"
        target={paying}
        onClose={() => setPaying(null)}
      />
      <ReceivableTable
        rows={rows}
        total={total}
        shopName={db.settings.shopName ?? ""}
        locale={i18n.language}
        onViewInvoice={(id) => {
          const o = db.orders.find((x) => x.id === id);
          if (o) setOpenOrder(o);
        }}
        onRecord={(r) => setPaying({ partyId: r.customerId, rowKey: r.key })}
        onAdd={() => setPaying({ partyId: "" })}
      />
    </PageContainer>
  );
}

export function PayablePage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const rows = useMemo(
    () => payableGroups(db.pos, db.suppliers).flatMap((g) => g.rows),
    [db.pos, db.suppliers],
  );
  const total = totalOwed(rows.map((r) => ({ owed: r.owed })));
  const [paying, setPaying] = useState<DebtPaymentTarget | null>(null);

  return (
    <PageContainer title={t("Payable", "Payable")}>
      <DebtPaymentModal
        side="PAYABLE"
        target={paying}
        onClose={() => setPaying(null)}
      />
      <PayableTable
        rows={rows}
        total={total}
        shopName={db.settings.shopName ?? ""}
        locale={i18n.language}
        onRecord={(r) => setPaying({ partyId: r.supplierId, rowKey: r.key })}
        onAdd={() => setPaying({ partyId: "" })}
      />
    </PageContainer>
  );
}

/*
 * Two tables below, deliberately not folded into one component. Their column
 * lists differ and one of them owns a *View invoice* button, and a table
 * component with a props switch for each of those is harder to read than the
 * two written out.
 */

function PayableTable({
  rows,
  total,
  shopName,
  locale,
  onRecord,
  onAdd,
}: {
  rows: readonly PayableRow[];
  total: number;
  shopName: string;
  locale: string;
  onRecord: (row: PayableRow) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();

  const doExport = (fmt: "xlsx" | "pdf") => {
    const now = new Date();
    const opts = {
      title: t("utang.payableExportTitle", "Payable — what we owe suppliers"),
      sheetName: t("utang.payable", "Payable"),
      filename: `payable-${stamp(now)}.${fmt}`,
      headLines: [
        shopName,
        t("utang.exportPrintedAt", "Printed {{when}}", {
          when: now.toLocaleString(locale),
        }),
      ],
      columns: [
        {
          key: "supplier",
          title: t("utang.supplier", "Supplier"),
          width: 32,
          pdfWeight: 2.4,
          value: (r: PayableRow) =>
            r.supplierName || t("utang.noSupplier", "No supplier named"),
        },
        {
          key: "date",
          title: t("utang.date", "Date"),
          width: 14,
          pdfWeight: 1,
          value: (r: PayableRow) => (r.at ? fmtDate(r.at) : fmtNone()),
        },
        {
          key: "inboundNo",
          title: t("utang.inboundNumber", "Inbound number"),
          width: 22,
          pdfWeight: 1.4,
          value: (r: PayableRow) =>
            r.opening
              ? t("utang.fromBefore", "From before this app")
              : r.invoiceNo
                ? `${r.code} · ${r.invoiceNo}`
                : r.code,
        },
        {
          key: "total",
          title: t("utang.total", "Total amount"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: PayableRow) => r.total,
        },
        {
          key: "paid",
          title: t("utang.settled", "Paid"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: PayableRow) => r.paid,
        },
        {
          key: "owed",
          title: t("utang.owed", "Owed"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: PayableRow) => r.owed,
        },
      ] as const,
      rows,
      totals: {
        inboundNo: t("utang.grandTotal", "Grand total"),
        owed: total,
      },
    };
    if (fmt === "xlsx") exportXlsx(opts);
    else exportPdf(opts);
  };

  return (
    <ProTable<PayableRow>
      persistKey="payable.flat"
      rowKey="key"
      dataSource={rows}
      searchPlaceholder={t(
        "utang.searchSupplierOrInvoice",
        "Search a supplier or an invoice",
      )}
      locale={{
        emptyText: t("utang.nothingPayable", "Every invoice is paid."),
      }}
      toolbar={
        <ExportButtons
          onXlsx={() => doExport("xlsx")}
          onPdf={() => doExport("pdf")}
        />
      }
      extra={
        <Flex align="center" gap={SPACE.md} wrap>
          <OwedFigure label={t("utang.weOweTotal", "We owe")} total={total} />
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
            {t("debtPay.add", "Add payment")}
          </Button>
        </Flex>
      }
      columns={[
        {
          title: t("utang.supplier", "Supplier"),
          dataIndex: "supplierName",
          searchable: true,
          facet: true,
          facetValue: (r) =>
            r.supplierName || t("utang.noSupplier", "No supplier named"),
          searchValue: (r) =>
            `${r.supplierName} ${r.code} ${r.invoiceNo ?? ""}`,
          sortValue: (r) => r.supplierName,
          render: (v: string) =>
            v || (
              <Typography.Text type="secondary">
                {t("utang.noSupplier", "No supplier named")}
              </Typography.Text>
            ),
        },
        {
          title: t("utang.date", "Date"),
          dataIndex: "at",
          width: 140,
          defaultSortOrder: "ascend",
          dateRange: true,
          render: (v: string) => (v === "" ? fmtNone() : fmtDate(v)),
        },
        {
          title: t("utang.inboundNumber", "Inbound number"),
          key: "inbound",
          width: 220,
          facet: true,
          facetValue: (r) =>
            r.opening ? t("utang.fromBefore", "From before this app") : r.code,
          sortValue: (r) => r.code,
          render: (_, r) =>
            r.opening ? (
              <Typography.Text type="secondary">
                {t("utang.fromBefore", "From before this app")}
              </Typography.Text>
            ) : (
              <Flex vertical gap={0}>
                <Link to={`/inbound/${r.key}`}>{r.code}</Link>
                {r.invoiceNo && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {r.invoiceNo}
                  </Typography.Text>
                )}
              </Flex>
            ),
        },
        {
          title: t("utang.total", "Total amount"),
          key: "total",
          width: 160,
          align: "right",
          sortValue: (r) => r.total,
          render: (_, r) => fmtRp(r.total),
        },
        {
          title: t("utang.settled", "Paid"),
          key: "paid",
          width: 160,
          align: "right",
          sortValue: (r) => r.paid,
          render: (_, r) => fmtRp(r.paid),
        },
        {
          title: t("utang.owed", "Owed"),
          key: "owed",
          width: 160,
          align: "right",
          sortValue: (r) => r.owed,
          render: (_, r) => (
            <Typography.Text strong style={{ color: OWED_COLOUR }}>
              {fmtRp(r.owed)}
            </Typography.Text>
          ),
        },
        {
          title: "",
          key: "actions",
          width: 150,
          render: (_, r) => (
            <RecordPaymentButton
              onClick={() => onRecord(r)}
              label={t(
                "debtPay.recordRowAria",
                "Record a payment on {{code}}",
                {
                  code: r.opening
                    ? t("utang.fromBefore", "From before this app")
                    : r.code,
                },
              )}
            />
          ),
        },
      ]}
    />
  );
}

function ReceivableTable({
  rows,
  total,
  shopName,
  locale,
  onViewInvoice,
  onRecord,
  onAdd,
}: {
  rows: readonly ReceivableRow[];
  total: number;
  shopName: string;
  locale: string;
  onViewInvoice: (orderId: string) => void;
  onRecord: (row: ReceivableRow) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();

  const doExport = (fmt: "xlsx" | "pdf") => {
    const now = new Date();
    const opts = {
      title: t(
        "utang.receivableExportTitle",
        "Receivable — what customers owe",
      ),
      sheetName: t("utang.receivable", "Receivable"),
      filename: `receivable-${stamp(now)}.${fmt}`,
      headLines: [
        shopName,
        t("utang.exportPrintedAt", "Printed {{when}}", {
          when: now.toLocaleString(locale),
        }),
      ],
      columns: [
        {
          key: "customer",
          title: t("utang.customer", "Customer"),
          width: 26,
          pdfWeight: 2,
          value: (r: ReceivableRow) => r.customerName,
        },
        {
          key: "date",
          title: t("utang.date", "Date"),
          width: 14,
          pdfWeight: 1,
          value: (r: ReceivableRow) => (r.at ? fmtDate(r.at) : fmtNone()),
        },
        {
          key: "phone",
          title: t("utang.phone", "Phone number"),
          width: 18,
          pdfWeight: 1.1,
          value: (r: ReceivableRow) => r.phone || "",
        },
        {
          key: "code",
          title: t("utang.transactionId", "Transaction ID"),
          width: 22,
          pdfWeight: 1.3,
          value: (r: ReceivableRow) =>
            r.opening ? t("utang.fromBefore", "From before this app") : r.code,
        },
        {
          key: "total",
          title: t("utang.total", "Total amount"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: ReceivableRow) => r.total,
        },
        {
          key: "paid",
          title: t("utang.settled", "Paid"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: ReceivableRow) => r.received,
        },
        {
          key: "owed",
          title: t("utang.owed", "Owed"),
          width: 18,
          pdfWeight: 1.2,
          numeric: true,
          value: (r: ReceivableRow) => r.owed,
        },
      ] as const,
      rows,
      totals: {
        code: t("utang.grandTotal", "Grand total"),
        owed: total,
      },
    };
    if (fmt === "xlsx") exportXlsx(opts);
    else exportPdf(opts);
  };

  return (
    <ProTable<ReceivableRow>
      persistKey="receivable.flat"
      rowKey="key"
      dataSource={rows}
      searchPlaceholder={t(
        "utang.searchCustomerOrOrder",
        "Search a customer, a phone number or a transaction",
      )}
      locale={{
        emptyText: t("utang.nothingReceivable", "Every customer has paid."),
      }}
      toolbar={
        <ExportButtons
          onXlsx={() => doExport("xlsx")}
          onPdf={() => doExport("pdf")}
        />
      }
      extra={
        <Flex align="center" gap={SPACE.md} wrap>
          <OwedFigure
            label={t("utang.owedToUsTotal", "Customers owe")}
            total={total}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
            {t("debtPay.add", "Add payment")}
          </Button>
        </Flex>
      }
      columns={[
        {
          title: t("utang.customer", "Customer"),
          dataIndex: "customerName",
          searchable: true,
          facet: true,
          searchValue: (r) => `${r.customerName} ${r.phone} ${r.code}`,
          sortValue: (r) => r.customerName,
          render: (v: string, r) => (
            <Flex align="center" gap={SPACE.xs}>
              <Typography.Text strong>{v}</Typography.Text>
              {r.overdue && (
                <Tag color="error">{t("utang.overdue", "Overdue")}</Tag>
              )}
            </Flex>
          ),
        },
        {
          title: t("utang.date", "Date"),
          dataIndex: "at",
          width: 140,
          defaultSortOrder: "ascend",
          dateRange: true,
          render: (v: string) => (v === "" ? fmtNone() : fmtDate(v)),
        },
        {
          title: t("utang.phone", "Phone number"),
          dataIndex: "phone",
          width: 160,
          facet: true,
          sortValue: (r) => r.phone,
          render: (v: string) => v || fmtNone(),
        },
        {
          title: t("utang.transactionId", "Transaction ID"),
          key: "code",
          width: 180,
          facet: true,
          facetValue: (r) =>
            r.opening ? t("utang.fromBefore", "From before this app") : r.code,
          sortValue: (r) => r.code,
          render: (_, r) =>
            r.opening ? (
              <Typography.Text type="secondary">
                {t("utang.fromBefore", "From before this app")}
              </Typography.Text>
            ) : (
              r.code
            ),
        },
        {
          title: t("utang.total", "Total amount"),
          key: "total",
          width: 150,
          align: "right",
          sortValue: (r) => r.total,
          render: (_, r) => fmtRp(r.total),
        },
        {
          title: t("utang.settled", "Paid"),
          key: "paid",
          width: 150,
          align: "right",
          sortValue: (r) => r.received,
          render: (_, r) => fmtRp(r.received),
        },
        {
          title: t("utang.owed", "Owed"),
          key: "owed",
          width: 150,
          align: "right",
          sortValue: (r) => r.owed,
          render: (_, r) => (
            <Typography.Text strong style={{ color: OWED_COLOUR }}>
              {fmtRp(r.owed)}
            </Typography.Text>
          ),
        },
        {
          title: "",
          key: "actions",
          width: 280,
          render: (_, r) => (
            <Space>
              {!r.opening && (
                <Button
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => onViewInvoice(r.key)}
                >
                  {t("utang.viewInvoice", "View invoice")}
                </Button>
              )}
              <RecordPaymentButton
                onClick={() => onRecord(r)}
                label={t(
                  "debtPay.recordRowAria",
                  "Record a payment on {{code}}",
                  {
                    code: r.opening
                      ? t("utang.fromBefore", "From before this app")
                      : r.code,
                  },
                )}
              />
            </Space>
          ),
        },
      ]}
    />
  );
}

function ExportButtons({
  onXlsx,
  onPdf,
}: {
  onXlsx: () => void;
  onPdf: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Space>
      <Button icon={<FileExcelOutlined />} onClick={onXlsx}>
        {t("export.xlsx", "Export .xlsx")}
      </Button>
      <Button icon={<FilePdfOutlined />} onClick={onPdf}>
        {t("export.pdf", "Export .pdf")}
      </Button>
    </Space>
  );
}
