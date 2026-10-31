/**
 * Receivable and Payable — two leaves of Financial & Report (owner ask
 * 2026-09-22), each one table grouped by the party it is about.
 *
 * > *"In 'Utang' or Payable, make it a expandable column per supplier, and the
 * > inbound is listed per the earliest date. The 'catat pembayaran' button
 * > should be on supplier level or transaction level, and it will autofill the
 * > transaction detail accordingly. Then when the user click per row (can be
 * > per supplier, per customer, per inbound, per transaction), the total next
 * > to 'Add payment' should be representative of the actual total/sum of the
 * > money owed/receivable."* (2026-09-24)
 *
 * ## One party, its documents under it
 *
 * The rows were flat for three days (2026-09-21, evening) and are a tree
 * again. A supplier sending three invoices a month was three rows repeating
 * one name, and the figure anybody acts on — what that supplier is owed in
 * total — was not on the screen at all. The parent row carries it; the
 * children are the invoices, **oldest first**, which is the order the supplier
 * telephones about them in.
 *
 * Drawn as antd tree data rather than an expanded panel, because the ticks
 * have to add up: `treeData` on `ProTable` sets `checkStrictly: false`, so
 * ticking a supplier ticks its invoices, and the page totals the LEAVES. That
 * is the last half of the ask — the figure beside *Add payment* is the sum of
 * what is ticked, and the whole page only while nothing is.
 *
 * ## Two buttons, one dialog
 *
 * Both open `DebtPaymentModal`. A document's *Record payment* opens it with
 * that one ticked; a PARTY's opens it with every document of theirs ticked, so
 * the amount box starts at what they are owed in total. *Add payment* opens it
 * on nobody.
 *
 * The rows still come out of `lib/payableReceivable.ts` where a test can read
 * them; this file turns each group into a parent row and draws it.
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
  type PayableGroup,
  type PayableRow,
  type ReceivableGroup,
  type ReceivableRow,
} from "../../lib/payableReceivable.js";
import { useDb } from "../../mock/store.js";
import { exportPdf, exportXlsx } from "../../lib/tableExport.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
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

/**
 * One row of either table: a party, or one of their documents.
 *
 * Deliberately ONE shape rather than a union. antd's tree data puts parents
 * and children through the same column renderers, so a column that has to ask
 * `kind` on every cell is simpler to read than one narrowing a union in eight
 * places. A field a party has no answer for is empty, and the renderer says so
 * — `docs` is the count under a parent, and is absent on a leaf.
 */
interface DebtNode {
  readonly key: string;
  readonly kind: "PARTY" | "DOC";
  readonly partyId: string;
  readonly partyName: string;
  /** The document's own number; "" on a party row. */
  readonly code: string;
  /** The other side's number — a supplier's invoice, a marketplace order. */
  readonly otherNo?: string;
  readonly phone: string;
  /** A document's date; a party's oldest. Empty means undated. */
  readonly at: string;
  readonly total: number;
  readonly paid: number;
  readonly owed: number;
  /** A debt from before this app — no document behind it. */
  readonly opening: boolean;
  readonly overdue: boolean;
  /** How many documents sit under a party row. Absent on a leaf. */
  readonly docs?: number;
  /** Every document key under a party — what its button ticks. */
  readonly docKeys?: readonly string[];
  readonly children?: readonly DebtNode[];
}

/**
 * What a page says it is owed or owes, beside its button.
 *
 * `picked` is how many rows are ticked; naming it keeps the figure honest —
 * "We owe" over a subtotal of three suppliers would read as the shop's whole
 * payable.
 */
function OwedFigure({
  label,
  total,
  picked,
}: {
  label: string;
  total: number;
  picked: number;
}) {
  const { t } = useTranslation();
  return (
    <Typography.Text>
      {picked > 0
        ? t("utang.selectedLabel", "{{count}} selected", { count: picked })
        : label}{" "}
      <Typography.Text strong style={{ color: OWED_COLOUR }}>
        {fmtRp(total)}
      </Typography.Text>
    </Typography.Text>
  );
}

/** A supplier's group and its invoices, as the table draws them. */
function payableNodes(groups: readonly PayableGroup[]): DebtNode[] {
  return groups.map((g) => {
    const children = g.rows.map<DebtNode>((r) => ({
      key: r.key,
      kind: "DOC",
      partyId: g.supplierId,
      partyName: g.supplierName,
      code: r.code,
      ...(r.invoiceNo === undefined ? {} : { otherNo: r.invoiceNo }),
      phone: "",
      at: r.at,
      total: r.total,
      paid: r.paid,
      owed: r.owed,
      opening: false,
      overdue: false,
    }));
    return {
      // Never a document's id: antd keys the whole tree from one namespace.
      key: `party-${g.supplierId}`,
      kind: "PARTY",
      partyId: g.supplierId,
      partyName: g.supplierName,
      code: "",
      phone: "",
      at: g.oldestAt ?? "",
      total: children.reduce((n, c) => n + c.total, 0),
      paid: children.reduce((n, c) => n + c.paid, 0),
      owed: g.owed,
      opening: false,
      overdue: false,
      docs: children.length,
      docKeys: children.map((c) => c.key),
      children,
    };
  });
}

/** A customer's group and their unpaid sales. */
function receivableNodes(groups: readonly ReceivableGroup[]): DebtNode[] {
  return groups.map((g) => {
    const children = g.rows.map<DebtNode>((r) => ({
      key: r.key,
      kind: "DOC",
      partyId: g.customerId,
      partyName: g.customerName,
      code: r.code,
      phone: r.phone,
      at: r.at,
      total: r.total,
      paid: r.received,
      owed: r.owed,
      opening: r.opening,
      overdue: r.overdue,
    }));
    return {
      key: `party-${g.customerId}`,
      kind: "PARTY",
      partyId: g.customerId,
      partyName: g.customerName,
      code: "",
      phone: g.phone,
      at: g.rows.map((r) => r.at).filter((a) => a !== "")[0] ?? "",
      total: children.reduce((n, c) => n + c.total, 0),
      paid: children.reduce((n, c) => n + c.paid, 0),
      owed: g.owed,
      opening: false,
      overdue: g.overdue,
      docs: children.length,
      docKeys: children.map((c) => c.key),
      children,
    };
  });
}

export function ReceivablePage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const walkIn = t("utang.walkIn", "Walk-in customers");
  const groups = useMemo(
    () => receivableGroups(db.orders, db.customers, walkIn),
    [db.orders, db.customers, walkIn],
  );
  const rows = useMemo(() => receivableNodes(groups), [groups]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
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
        exportRows={flat}
        total={total}
        shopName={db.settings.shopName ?? ""}
        locale={i18n.language}
        onViewInvoice={(id) => {
          const o = db.orders.find((x) => x.id === id);
          if (o) setOpenOrder(o);
        }}
        onRecord={(r) =>
          setPaying({ partyId: r.partyId, rowKeys: r.docKeys ?? [r.key] })
        }
        onAdd={() => setPaying({ partyId: "" })}
      />
    </PageContainer>
  );
}

export function PayablePage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const groups = useMemo(
    () => payableGroups(db.pos, db.suppliers),
    [db.pos, db.suppliers],
  );
  const rows = useMemo(() => payableNodes(groups), [groups]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
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
        exportRows={flat}
        total={total}
        shopName={db.settings.shopName ?? ""}
        locale={i18n.language}
        onRecord={(r) =>
          setPaying({ partyId: r.partyId, rowKeys: r.docKeys ?? [r.key] })
        }
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

/** Σ what is ticked, or the whole page when nothing is. */
function pickedTotal(selected: readonly DebtNode[], whole: number) {
  const docs = selected.filter((r) => r.kind === "DOC");
  return docs.length === 0
    ? { total: whole, picked: 0 }
    : { total: docs.reduce((n, r) => n + r.owed, 0), picked: docs.length };
}

function PayableTable({
  rows,
  exportRows,
  total,
  shopName,
  locale,
  onRecord,
  onAdd,
}: {
  rows: readonly DebtNode[];
  exportRows: readonly PayableRow[];
  total: number;
  shopName: string;
  locale: string;
  onRecord: (row: DebtNode) => void;
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
            r.invoiceNo ? `${r.code} · ${r.invoiceNo}` : r.code,
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
      rows: exportRows,
      totals: {
        inboundNo: t("utang.grandTotal", "Grand total"),
        owed: total,
      },
    };
    if (fmt === "xlsx") exportXlsx(opts);
    else exportPdf(opts);
  };

  return (
    <ProTable<DebtNode>
      lazy
      persistKey="payable.bySupplier"
      rowKey="key"
      treeData
      selectable
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
      extra={(selected) => {
        const { total: shown, picked } = pickedTotal(selected, total);
        return (
          <Flex align="center" gap={SPACE.md} wrap>
            <OwedFigure
              label={t("utang.weOweTotal", "We owe")}
              total={shown}
              picked={picked}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              {t("debtPay.add", "Add payment")}
            </Button>
          </Flex>
        );
      }}
      columns={[
        {
          title: t("utang.supplier", "Supplier"),
          key: "supplier",
          searchable: true,
          facet: true,
          facetValue: (r) =>
            r.partyName || t("utang.noSupplier", "No supplier named"),
          // A supplier's own row carries its invoices' numbers into the
          // search box: the children are not searched, so without this a
          // PI code would narrow the list to nothing.
          searchValue: (r) =>
            [
              r.partyName,
              ...(r.children ?? []).map((c) => `${c.code} ${c.otherNo ?? ""}`),
            ].join(" "),
          sortValue: (r) => r.partyName,
          render: (_, r) =>
            r.kind === "PARTY" ? (
              <Flex vertical gap={0}>
                <Typography.Text strong>
                  {r.partyName || (
                    <Typography.Text type="secondary">
                      {t("utang.noSupplier", "No supplier named")}
                    </Typography.Text>
                  )}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {t("utang.invoiceCount", "{{count}} unpaid invoice(s)", {
                    count: r.docs ?? 0,
                  })}
                </Typography.Text>
              </Flex>
            ) : null,
        },
        {
          title: t("utang.date", "Date"),
          key: "at",
          width: COLUMN.date,
          defaultSortOrder: "ascend",
          dateRange: true,
          sortValue: (r) => r.at,
          render: (_, r) => (r.at === "" ? fmtNone() : fmtDate(r.at)),
        },
        {
          title: t("utang.inboundNumber", "Inbound number"),
          key: "inbound",
          width: COLUMN.code,
          render: (_, r) =>
            r.kind === "PARTY" ? null : (
              <Flex vertical gap={0}>
                <Link to={`/inbound/${r.key}`}>{r.code}</Link>
                {r.otherNo && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {r.otherNo}
                  </Typography.Text>
                )}
              </Flex>
            ),
        },
        {
          title: t("utang.total", "Total amount"),
          key: "total",
          width: COLUMN.money,
          align: "right",
          sortValue: (r) => r.total,
          render: (_, r) => fmtRp(r.total),
        },
        {
          title: t("utang.settled", "Paid"),
          key: "paid",
          width: COLUMN.money,
          align: "right",
          sortValue: (r) => r.paid,
          render: (_, r) => fmtRp(r.paid),
        },
        {
          title: t("utang.owed", "Owed"),
          key: "owed",
          width: COLUMN.money,
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
          width: COLUMN.actionsPair,
          render: (_, r) => (
            <RecordPaymentButton
              onClick={() => onRecord(r)}
              label={
                r.kind === "PARTY"
                  ? t(
                      "debtPay.recordPartyAria",
                      "Record a payment to {{name}}",
                      {
                        name: r.partyName,
                      },
                    )
                  : t("debtPay.recordRowAria", "Record a payment on {{code}}", {
                      code: r.code,
                    })
              }
            />
          ),
        },
      ]}
    />
  );
}

function ReceivableTable({
  rows,
  exportRows,
  total,
  shopName,
  locale,
  onViewInvoice,
  onRecord,
  onAdd,
}: {
  rows: readonly DebtNode[];
  exportRows: readonly ReceivableRow[];
  total: number;
  shopName: string;
  locale: string;
  onViewInvoice: (orderId: string) => void;
  onRecord: (row: DebtNode) => void;
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
      rows: exportRows,
      totals: {
        code: t("utang.grandTotal", "Grand total"),
        owed: total,
      },
    };
    if (fmt === "xlsx") exportXlsx(opts);
    else exportPdf(opts);
  };

  return (
    <ProTable<DebtNode>
      lazy
      persistKey="receivable.byCustomer"
      rowKey="key"
      treeData
      selectable
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
      extra={(selected) => {
        const { total: shown, picked } = pickedTotal(selected, total);
        return (
          <Flex align="center" gap={SPACE.md} wrap>
            <OwedFigure
              label={t("utang.owedToUsTotal", "Customers owe")}
              total={shown}
              picked={picked}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              {t("debtPay.add", "Add payment")}
            </Button>
          </Flex>
        );
      }}
      columns={[
        {
          title: t("utang.customer", "Customer"),
          key: "customer",
          searchable: true,
          facet: true,
          facetValue: (r) => r.partyName,
          searchValue: (r) =>
            [
              r.partyName,
              r.phone,
              ...(r.children ?? []).map((c) => c.code),
            ].join(" "),
          sortValue: (r) => r.partyName,
          render: (_, r) =>
            r.kind === "PARTY" ? (
              <Flex vertical gap={0}>
                <Flex align="center" gap={SPACE.xs}>
                  <Typography.Text strong>{r.partyName}</Typography.Text>
                  {r.overdue && (
                    <Tag color="error">{t("utang.overdue", "Overdue")}</Tag>
                  )}
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {t("utang.saleCount", "{{count}} unpaid transaction(s)", {
                    count: r.docs ?? 0,
                  })}
                </Typography.Text>
              </Flex>
            ) : null,
        },
        {
          title: t("utang.date", "Date"),
          key: "at",
          width: COLUMN.date,
          defaultSortOrder: "ascend",
          dateRange: true,
          sortValue: (r) => r.at,
          render: (_, r) => (r.at === "" ? fmtNone() : fmtDate(r.at)),
        },
        {
          title: t("utang.phone", "Phone number"),
          key: "phone",
          width: COLUMN.code,
          facet: true,
          facetValue: (r) => r.phone,
          sortValue: (r) => r.phone,
          render: (_, r) => (r.kind === "PARTY" ? r.phone || fmtNone() : null),
        },
        {
          title: t("utang.transactionId", "Transaction ID"),
          key: "code",
          width: COLUMN.code,
          render: (_, r) =>
            r.kind === "PARTY" ? null : r.opening ? (
              <Typography.Text type="secondary">
                {t("utang.fromBefore", "From before this app")}
              </Typography.Text>
            ) : (
              <Flex align="center" gap={SPACE.xs}>
                <span>{r.code}</span>
                {r.overdue && (
                  <Tag color="error">{t("utang.overdue", "Overdue")}</Tag>
                )}
              </Flex>
            ),
        },
        {
          title: t("utang.total", "Total amount"),
          key: "total",
          width: COLUMN.money,
          align: "right",
          sortValue: (r) => r.total,
          render: (_, r) => fmtRp(r.total),
        },
        {
          title: t("utang.settled", "Paid"),
          key: "paid",
          width: COLUMN.money,
          align: "right",
          sortValue: (r) => r.paid,
          render: (_, r) => fmtRp(r.paid),
        },
        {
          title: t("utang.owed", "Owed"),
          key: "owed",
          width: COLUMN.money,
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
          // At the floor a document's two buttons stack; with room to spare
          // they stand side by side (2026-09-28: the table fits a 1440 screen
          // rather than scrolling for a button's sake).
          width: COLUMN.actionsPair,
          render: (_, r) => (
            <Space wrap size={[8, 4]}>
              {r.kind === "DOC" && !r.opening && (
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
                label={
                  r.kind === "PARTY"
                    ? t(
                        "debtPay.recordPartyAria",
                        "Record a payment to {{name}}",
                        { name: r.partyName },
                      )
                    : t(
                        "debtPay.recordRowAria",
                        "Record a payment on {{code}}",
                        {
                          code: r.opening
                            ? t("utang.fromBefore", "From before this app")
                            : r.code,
                        },
                      )
                }
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
