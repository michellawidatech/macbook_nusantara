/**
 * Profit & Loss — Laba Rugi (owner ask 2026-10-23), laid out after Olsera
 * Akunting's report: shop and period on top, then each section's lines, what
 * is taken off in brackets, and a total under each. No account codes (owner,
 * the same day). The arithmetic is `lib/profitLoss.ts`; this file draws it.
 *
 * Three tabs (owner, the same day):
 * - **Statement** — click a line and the transactions behind it are listed on
 *   the right.
 * - **Profit per unit** — per product, what one piece made on average.
 * - **By month** — twelve months of revenue, gross and net profit, as a graph
 *   and a table.
 *
 * *Export* asks what to write — the statement, or every transaction behind
 * it — and as .xlsx or .pdf.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Card,
  Col,
  DatePicker,
  Flex,
  Modal,
  Radio,
  Row as AntRow,
  Segmented,
  Table,
  Tabs,
  Typography,
  theme,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { useDb } from "../../mock/store.js";
import { fmtDate, fmtRp } from "../../lib/format.js";
import {
  monthPeriod,
  monthlyProfitLoss,
  profitLoss,
  unitProfits,
  type Period,
  type PnlItem,
  type PnlLine,
  type ProfitLoss,
  type UnitProfitRow,
} from "../../lib/profitLoss.js";
import {
  exportPdf,
  exportXlsx,
  type TableExportOptions,
} from "../../lib/tableExport.js";
import { COLUMN, SPACE } from "../../theme/tokens";

/** What is taken off prints in brackets, as on Olsera's report. */
export const fmtPnl = (n: number): string =>
  n < 0 ? `(${fmtRp(-n)})` : fmtRp(Math.abs(n));

/** Millions on the graph's axis: "Rp 12 jt". */
const fmtShort = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`
    : fmtRp(n);

type Mode = "month" | "range";
type Tab = "statement" | "units" | "months";

/** One printed row of the statement — on screen and in the export alike. */
interface Row {
  readonly kind: "heading" | "line" | "total" | "grand";
  readonly key?: string;
  readonly label: string;
  readonly amount?: number;
  readonly items?: readonly PnlItem[];
}

export function ProfitLossPage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const { token } = theme.useToken();
  const [tab, setTab] = useState<Tab>("statement");
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState<Dayjs>(() => dayjs());
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const period: Period = useMemo(() => {
    if (mode === "range" && range !== null)
      return {
        from: range[0].startOf("day").toDate(),
        until: range[1].add(1, "day").startOf("day").toDate(),
      };
    return monthPeriod(month.toDate());
  }, [mode, month, range]);

  const report = useMemo(() => profitLoss(db, period), [db, period]);
  const perUnit = useMemo(() => unitProfits(db, period), [db, period]);
  // Twelve months ending with the one the period ends in.
  const months = useMemo(
    () => monthlyProfitLoss(db, new Date(period.until.getTime() - 1), 12),
    [db, period],
  );

  /** A line's name, as literal `t()` calls — the i18n test reads them. */
  const lineLabel = (key: string): string => {
    switch (key) {
      case "sales":
        return t("pnl.sales", "Sales");
      case "outsideSales":
        return t("pnl.outsideSales", "Sales recorded outside the app");
      case "charges":
        return t("pnl.charges", "Delivery & extra charges");
      case "discounts":
        return t("pnl.discounts", "Sales discounts");
      case "returns":
        return t("pnl.returns", "Sales returns");
      case "cogsSold":
        return t("pnl.cogsSold", "Cost of units sold");
      case "cogsReturned":
        return t("pnl.cogsReturned", "Cost of units returned to stock");
      case "OPERATIONAL":
        return t("pnl.operational", "Operational");
      case "PAYROLL":
        return t("pnl.payroll", "Payroll");
      case "MARKETING":
        return t("pnl.marketing", "Marketing & advertisement");
      case "RENT":
        return t("pnl.rent", "Rent and facilities");
      case "PROFESSIONAL":
        return t("pnl.professional", "Professional services");
      case "SOFTWARE":
        return t("pnl.software", "Software & technology");
      case "BIAYA_ADMIN":
        return t("pnl.bankFees", "Bank & marketplace fees");
      case "ONGKIR":
        return t("pnl.shipping", "Shipping / ongkir");
      case "interestIn":
        return t("pnl.interestIn", "Interest received");
      case "mismatchIn":
        return t("pnl.mismatchIn", "Balance above the books");
      case "dpForfeited":
        return t("pnl.dpForfeited", "DP hangus (kept DPs)");
      case "interestOut":
        return t("pnl.interestOut", "Interest and bank charges");
      case "mismatchOut":
        return t("pnl.mismatchOut", "Balance short of the books");
      case "compensation":
        return t("pnl.compensation", "Customer compensation");
      case "stockAdjust":
        return t("pnl.stockAdjust", "Stock adjustments");
      default:
        return key;
    }
  };

  // A few dozen rows: cheap to rebuild, and rebuilt with the language.
  const rows = statementRows(report, lineLabel, t);
  const pickedRow = rows.find((r) => r.kind === "line" && r.key === picked);

  const periodText =
    mode === "range" && range !== null
      ? `${range[0].format("DD MMM YYYY")} – ${range[1].format("DD MMM YYYY")}`
      : month.format("MMMM YYYY");
  const shopName = db.settings.shopName ?? "";

  const headLines = () => [
    shopName,
    periodText,
    t("utang.exportPrintedAt", "Printed {{when}}", {
      when: new Date().toLocaleString(i18n.language),
    }),
  ];
  const stamp = dayjs(period.from).format("YYYY-MM-DD");

  const doExport = (what: "statement" | "detail", fmt: "xlsx" | "pdf") => {
    const write = <R,>(opts: TableExportOptions<R>) =>
      fmt === "xlsx" ? exportXlsx(opts) : exportPdf(opts);
    if (what === "statement") {
      write<Row>({
        title: t("pnl.reportTitle", "Profit & Loss Statement"),
        sheetName: t("pnl.title", "Profit & Loss"),
        filename: `laba-rugi-${stamp}.${fmt}`,
        headLines: headLines(),
        columns: [
          {
            key: "label",
            title: t("pnl.account", "Account"),
            width: 48,
            pdfWeight: 3,
            value: (r) =>
              r.kind === "line" ? `    ${r.label}` : r.label.toUpperCase(),
          },
          {
            key: "amount",
            title: t("pnl.amount", "Amount"),
            width: 20,
            pdfWeight: 1.4,
            numeric: true,
            value: (r) => (r.amount === undefined ? "" : fmtPnl(r.amount)),
          },
        ],
        rows,
      });
      return;
    }
    // Every transaction behind every line, the line named on each.
    const detail = rows.flatMap((r) =>
      r.kind === "line"
        ? (r.items ?? []).map((i) => ({ line: r.label, ...i }))
        : [],
    );
    write<(typeof detail)[number]>({
      title: t("pnl.detailTitle", "Profit & Loss — transactions"),
      sheetName: t("pnl.detailSheet", "Transactions"),
      filename: `laba-rugi-detail-${stamp}.${fmt}`,
      headLines: headLines(),
      landscape: true,
      columns: [
        {
          key: "line",
          title: t("pnl.account", "Account"),
          width: 30,
          pdfWeight: 1.6,
          value: (r) => r.line,
        },
        {
          key: "date",
          title: t("pnl.date", "Date"),
          width: 14,
          value: (r) => fmtDate(r.date),
        },
        {
          key: "ref",
          title: t("pnl.ref", "Transaction"),
          width: 22,
          pdfWeight: 1.2,
          value: (r) => r.ref,
        },
        {
          key: "description",
          title: t("pnl.description", "Description"),
          width: 44,
          pdfWeight: 2.4,
          value: (r) => r.description,
        },
        {
          key: "amount",
          title: t("pnl.amount", "Amount"),
          width: 18,
          numeric: true,
          value: (r) => fmtPnl(r.amount),
        },
      ],
      rows: detail,
    });
  };

  const periodPicker = (
    <Flex wrap gap={SPACE.sm} align="center">
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: "month", label: t("pnl.byMonth", "Month") },
          { value: "range", label: t("pnl.byRange", "Date range") },
        ]}
      />
      {mode === "month" ? (
        <DatePicker
          picker="month"
          allowClear={false}
          value={month}
          onChange={(v) => v && setMonth(v)}
          format="MMMM YYYY"
          aria-label={t("pnl.month", "Month")}
        />
      ) : (
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          format="DD MMM YYYY"
        />
      )}
    </Flex>
  );

  const statement = (
    <AntRow gutter={[SPACE.md, SPACE.md]}>
      <Col xs={24} xl={13}>
        <Card>
          <Flex vertical align="center" style={{ marginBottom: SPACE.md }}>
            <Typography.Text strong>{shopName}</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("pnl.reportTitle", "Profit & Loss Statement")}
            </Typography.Title>
            <Typography.Text type="secondary">{periodText}</Typography.Text>
          </Flex>
          <div role="table" aria-label={t("pnl.title", "Profit & Loss")}>
            {rows.map((r, i) => (
              <StatementRow
                key={`${r.kind}-${r.key ?? r.label}-${i}`}
                row={r}
                border={token.colorBorderSecondary}
                selected={r.kind === "line" && r.key === picked}
                selectedBg={token.colorPrimaryBg}
                onPick={
                  r.kind === "line" ? () => setPicked(r.key ?? null) : undefined
                }
              />
            ))}
          </div>
          {report.sales === 0 && (
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: SPACE.md, marginBottom: 0 }}
            >
              {t("pnl.noSales", "No sale was recorded in this period.")}
            </Typography.Paragraph>
          )}
        </Card>
      </Col>
      <Col xs={24} xl={11}>
        <Card
          title={
            pickedRow
              ? `${pickedRow.label} · ${fmtPnl(pickedRow.amount ?? 0)}`
              : t("pnl.detailHeading", "Transactions")
          }
          style={{ position: "sticky", top: SPACE.md }}
        >
          {pickedRow === undefined ? (
            <Typography.Text type="secondary">
              {t(
                "pnl.pickLine",
                "Click a line of the statement to see the transactions behind it.",
              )}
            </Typography.Text>
          ) : (
            <Table<PnlItem>
              size="small"
              rowKey={(r) => `${r.ref}-${r.date}-${r.description}-${r.amount}`}
              dataSource={[...(pickedRow.items ?? [])]}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              scroll={{ y: 560 }}
              locale={{
                emptyText: t("pnl.noItems", "Nothing in this line."),
              }}
              columns={[
                {
                  title: t("pnl.date", "Date"),
                  dataIndex: "date",
                  width: COLUMN.date,
                  render: (v: string) => fmtDate(v),
                },
                {
                  title: t("pnl.ref", "Transaction"),
                  dataIndex: "ref",
                  width: COLUMN.code,
                },
                {
                  title: t("pnl.description", "Description"),
                  dataIndex: "description",
                },
                {
                  title: t("pnl.amount", "Amount"),
                  dataIndex: "amount",
                  align: "right",
                  width: COLUMN.money,
                  render: (v: number) => fmtPnl(v),
                },
              ]}
            />
          )}
        </Card>
      </Col>
    </AntRow>
  );

  const unitsTab = (
    <ProTable<UnitProfitRow>
      lazy
      persistKey="pnl.perUnit"
      rowKey="skuId"
      dataSource={perUnit}
      searchPlaceholder={t("pnl.searchProduct", "Search a product")}
      locale={{
        emptyText: t("pnl.noSales", "No sale was recorded in this period."),
      }}
      columns={[
        {
          title: t("pnl.product", "Product"),
          key: "name",
          dataIndex: "name",
          searchable: true,
          sortValue: (r) => r.name,
        },
        {
          title: t("pnl.sold", "Sold"),
          key: "sold",
          dataIndex: "sold",
          align: "right",
          width: COLUMN.qty,
          sortValue: (r) => r.sold,
        },
        {
          title: t("pnl.revenue", "Revenue"),
          key: "revenue",
          align: "right",
          width: COLUMN.money,
          sortValue: (r) => r.revenue,
          render: (_, r) => fmtRp(r.revenue),
        },
        {
          title: t("pnl.cost", "Cost"),
          key: "cost",
          align: "right",
          width: COLUMN.money,
          sortValue: (r) => r.cost,
          render: (_, r) => fmtRp(r.cost),
        },
        {
          title: t("pnl.profit", "Profit"),
          key: "profit",
          align: "right",
          width: COLUMN.money,
          sortValue: (r) => r.profit,
          render: (_, r) => fmtPnl(r.profit),
        },
        {
          title: t("pnl.perUnit", "Average profit per unit"),
          key: "perUnit",
          align: "right",
          width: COLUMN.money + 40,
          sortValue: (r) => r.perUnit,
          render: (_, r) => <strong>{fmtPnl(r.perUnit)}</strong>,
        },
        {
          title: t("pnl.margin", "Margin"),
          key: "margin",
          align: "right",
          width: COLUMN.qty,
          sortValue: (r) => r.margin,
          render: (_, r) => `${(r.margin * 100).toFixed(1)}%`,
        },
      ]}
    />
  );

  const monthsTab = (
    <Flex vertical gap={SPACE.md}>
      <Card>
        <TimeSeriesChart
          categories={months.map((m) => dayjs(m.month).format("MMM YY"))}
          series={[
            {
              key: "revenue",
              label: t("pnl.totalRevenue", "Total revenue"),
              values: months.map((m) => m.revenue),
            },
            {
              key: "gross",
              label: t("pnl.grossProfit", "Gross profit"),
              values: months.map((m) => m.grossProfit),
            },
            {
              key: "net",
              label: t("pnl.netProfit", "Net profit"),
              values: months.map((m) => m.netProfit),
            },
          ]}
          format={fmtRp}
          formatTick={fmtShort}
          height={320}
        />
      </Card>
      <Table
        size="small"
        rowKey={(m) => m.month.toISOString()}
        pagination={false}
        dataSource={[...months].reverse()}
        columns={[
          {
            title: t("pnl.month", "Month"),
            key: "month",
            render: (_, m) => dayjs(m.month).format("MMMM YYYY"),
          },
          {
            title: t("pnl.totalRevenue", "Total revenue"),
            key: "revenue",
            align: "right",
            render: (_, m) => fmtRp(m.revenue),
          },
          {
            title: t("pnl.grossProfit", "Gross profit"),
            key: "gross",
            align: "right",
            render: (_, m) => fmtPnl(m.grossProfit),
          },
          {
            title: t("pnl.netProfit", "Net profit"),
            key: "net",
            align: "right",
            render: (_, m) => fmtPnl(m.netProfit),
          },
        ]}
      />
    </Flex>
  );

  return (
    <PageContainer
      title={t("pnl.title", "Profit & Loss")}
      actions={[
        {
          key: "export",
          label: t("pnl.export", "Export"),
          icon: <DownloadOutlined />,
          onClick: () => setExporting(true),
        },
      ]}
    >
      <Flex vertical gap={SPACE.md}>
        {periodPicker}
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as Tab)}
          items={[
            {
              key: "statement",
              label: t("pnl.tabStatement", "Statement"),
              children: statement,
            },
            {
              key: "units",
              label: t("pnl.tabUnits", "Profit per unit"),
              children: unitsTab,
            },
            {
              key: "months",
              label: t("pnl.tabMonths", "By month"),
              children: monthsTab,
            },
          ]}
        />
      </Flex>
      <ExportDialog
        open={exporting}
        onClose={() => setExporting(false)}
        onExport={(what, fmt) => {
          doExport(what, fmt);
          setExporting(false);
        }}
      />
    </PageContainer>
  );
}

/** What to write, and in which format. */
function ExportDialog({
  open,
  onClose,
  onExport,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onExport: (
    what: "statement" | "detail",
    fmt: "xlsx" | "pdf",
  ) => void;
}) {
  const { t } = useTranslation();
  const [what, setWhat] = useState<"statement" | "detail">("statement");
  const [fmt, setFmt] = useState<"xlsx" | "pdf">("xlsx");
  return (
    <Modal
      open={open}
      title={t("pnl.export", "Export")}
      okText={t("pnl.exportOk", "Download")}
      onOk={() => onExport(what, fmt)}
      onCancel={onClose}
      width={420}
    >
      <Flex vertical gap={SPACE.md}>
        <Radio.Group
          value={what}
          onChange={(e) => setWhat(e.target.value as typeof what)}
        >
          <Flex vertical gap={SPACE.xs}>
            <Radio value="statement">
              {t("pnl.exportStatement", "The statement")}
            </Radio>
            <Radio value="detail">
              {t("pnl.exportDetail", "Every transaction behind it")}
            </Radio>
          </Flex>
        </Radio.Group>
        <Segmented<"xlsx" | "pdf">
          value={fmt}
          onChange={setFmt}
          options={[
            { value: "xlsx", label: t("pnl.formatXlsx", "Excel (.xlsx)") },
            { value: "pdf", label: t("pnl.formatPdf", "PDF (.pdf)") },
          ]}
        />
      </Flex>
    </Modal>
  );
}

function StatementRow({
  row,
  border,
  selected,
  selectedBg,
  onPick,
}: {
  row: Row;
  border: string;
  selected: boolean;
  selectedBg: string;
  onPick?: () => void;
}) {
  const strong = row.kind !== "line";
  const cell = (child: ReactNode, style?: CSSProperties) => (
    <div role="cell" style={style}>
      {child}
    </div>
  );
  return (
    <div
      role="row"
      tabIndex={onPick ? 0 : undefined}
      aria-selected={onPick ? selected : undefined}
      onClick={onPick}
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick();
              }
            }
          : undefined
      }
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 180px",
        gap: SPACE.sm,
        padding: "6px 8px",
        borderRadius: 6,
        cursor: onPick ? "pointer" : undefined,
        background: selected ? selectedBg : undefined,
        fontWeight: strong ? 600 : 400,
        marginTop: row.kind === "heading" ? SPACE.sm : 0,
        borderTop:
          row.kind === "total" || row.kind === "grand"
            ? `1px solid ${border}`
            : undefined,
        borderBottom: row.kind === "grand" ? `3px double ${border}` : undefined,
      }}
    >
      {cell(row.label, { paddingLeft: row.kind === "line" ? SPACE.md : 0 })}
      {cell(row.amount === undefined ? "" : fmtPnl(row.amount), {
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      })}
    </div>
  );
}

/** The statement, top to bottom, in Olsera's order. */
function statementRows(
  r: ProfitLoss,
  label: (key: string) => string,
  t: (key: string, fallback: string) => string,
): Row[] {
  // Each line as it adds into its own section: a cost is a plain figure in a
  // cost section, and only what is taken off (a discount, a return, stock
  // coming back) is bracketed — as on Olsera's report.
  const lines = (ls: readonly PnlLine[]): Row[] =>
    ls.map((l) => ({
      kind: "line",
      key: l.key,
      label: label(l.key),
      amount: l.amount,
      items: l.items,
    }));
  return [
    { kind: "heading", label: t("pnl.revenue", "Revenue") },
    ...lines(r.revenue),
    {
      kind: "total",
      label: t("pnl.totalRevenue", "Total revenue"),
      amount: r.totalRevenue,
    },
    { kind: "heading", label: t("pnl.cogs", "Cost of goods sold") },
    ...lines(r.cogs),
    {
      kind: "total",
      label: t("pnl.totalCogs", "Total cost of goods sold"),
      amount: r.totalCogs,
    },
    {
      kind: "grand",
      label: t("pnl.grossProfit", "Gross profit"),
      amount: r.grossProfit,
    },
    { kind: "heading", label: t("pnl.operating", "Operating expenses") },
    ...lines(r.operating),
    {
      kind: "total",
      label: t("pnl.totalOperating", "Total operating expenses"),
      amount: r.totalOperating,
    },
    {
      kind: "grand",
      label: t("pnl.operatingProfit", "Net operating income"),
      amount: r.operatingProfit,
    },
    { kind: "heading", label: t("pnl.otherIncome", "Non-operating income") },
    ...lines(r.otherIncome),
    {
      kind: "heading",
      label: t("pnl.otherExpense", "Non-operating expenses"),
    },
    ...lines(r.otherExpense),
    {
      kind: "total",
      label: t("pnl.totalOther", "Total non-operating"),
      amount: r.totalOther,
    },
    {
      kind: "grand",
      label: t("pnl.netProfit", "Net profit"),
      amount: r.netProfit,
    },
  ];
}
