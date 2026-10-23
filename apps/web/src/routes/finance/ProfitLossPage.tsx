/**
 * Profit & Loss — Laba Rugi (owner ask 2026-10-23), laid out after Olsera
 * Akunting's report: shop and period on top, then each section's lines with
 * an account code, what is taken off in brackets, and a total under each.
 * The arithmetic is `lib/profitLoss.ts`; this file only draws and exports it.
 *
 * A month at a time by default — the book closes by the month — or any range.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card, DatePicker, Flex, Segmented, Typography, theme } from "antd";
import { FilePdfOutlined, FileExcelOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { useDb } from "../../mock/store.js";
import { fmtRp } from "../../lib/format.js";
import {
  monthPeriod,
  profitLoss,
  type Period,
  type PnlLine,
  type ProfitLoss,
} from "../../lib/profitLoss.js";
import { exportPdf, exportXlsx } from "../../lib/tableExport.js";
import { SPACE } from "../../theme/tokens";

/** What is taken off prints in brackets, as on Olsera's report. */
export const fmtPnl = (n: number): string =>
  n < 0 ? `(${fmtRp(-n)})` : fmtRp(Math.abs(n));

type Mode = "month" | "range";

/** One printed row of the statement — on screen and in the export alike. */
interface Row {
  readonly kind: "heading" | "line" | "total" | "grand";
  readonly code?: string;
  readonly label: string;
  readonly amount?: number;
}

export function ProfitLossPage() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const { token } = theme.useToken();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState<Dayjs>(() => dayjs());
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const period: Period = useMemo(() => {
    if (mode === "range" && range !== null)
      return {
        from: range[0].startOf("day").toDate(),
        until: range[1].add(1, "day").startOf("day").toDate(),
      };
    return monthPeriod(month.toDate());
  }, [mode, month, range]);

  const report = useMemo(() => profitLoss(db, period), [db, period]);

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
      case "marketplaceFees":
        return t("pnl.marketplaceFees", "Marketplace fees");
      case "interestIn":
        return t("pnl.interestIn", "Interest received");
      case "mismatchIn":
        return t("pnl.mismatchIn", "Balance above the books");
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

  const periodText =
    mode === "range" && range !== null
      ? `${range[0].format("DD MMM YYYY")} – ${range[1].format("DD MMM YYYY")}`
      : month.format("MMMM YYYY");
  const shopName = db.settings.shopName ?? "";

  const doExport = (fmt: "xlsx" | "pdf") => {
    const now = new Date();
    const opts = {
      title: t("pnl.title", "Profit & Loss"),
      sheetName: t("pnl.title", "Profit & Loss"),
      filename: `laba-rugi-${dayjs(period.from).format("YYYY-MM-DD")}.${fmt}`,
      headLines: [
        shopName,
        periodText,
        t("utang.exportPrintedAt", "Printed {{when}}", {
          when: now.toLocaleString(i18n.language),
        }),
      ],
      columns: [
        {
          key: "code",
          title: t("pnl.code", "Code"),
          width: 10,
          pdfWeight: 0.6,
          value: (r: Row) => r.code ?? "",
        },
        {
          key: "label",
          title: t("pnl.account", "Account"),
          width: 44,
          pdfWeight: 3,
          value: (r: Row) =>
            r.kind === "line" ? `    ${r.label}` : r.label.toUpperCase(),
        },
        {
          key: "amount",
          title: t("pnl.amount", "Amount"),
          width: 20,
          pdfWeight: 1.4,
          numeric: true,
          value: (r: Row) => (r.amount === undefined ? "" : fmtPnl(r.amount)),
        },
      ],
      rows,
    };
    if (fmt === "xlsx") exportXlsx(opts);
    else exportPdf(opts);
  };

  return (
    <PageContainer
      title={t("pnl.title", "Profit & Loss")}
      actions={[
        {
          key: "xlsx",
          label: t("pnl.exportXlsx", "Export .xlsx"),
          icon: <FileExcelOutlined />,
          onClick: () => doExport("xlsx"),
        },
        {
          key: "pdf",
          label: t("pnl.exportPdf", "Export .pdf"),
          icon: <FilePdfOutlined />,
          onClick: () => doExport("pdf"),
        },
      ]}
    >
      <Flex vertical gap={SPACE.md}>
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
              onChange={(v) =>
                setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
              }
              format="DD MMM YYYY"
            />
          )}
        </Flex>

        <Card style={{ maxWidth: 860 }}>
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
                key={`${r.kind}-${r.code ?? r.label}-${i}`}
                row={r}
                border={token.colorBorderSecondary}
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
      </Flex>
    </PageContainer>
  );
}

function StatementRow({ row, border }: { row: Row; border: string }) {
  const strong = row.kind !== "line";
  const cell = (child: ReactNode, style?: CSSProperties) => (
    <div role="cell" style={style}>
      {child}
    </div>
  );
  return (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns: "72px 1fr 180px",
        gap: SPACE.sm,
        padding: "6px 0",
        fontWeight: strong ? 600 : 400,
        marginTop: row.kind === "heading" ? SPACE.sm : 0,
        borderTop:
          row.kind === "total" || row.kind === "grand"
            ? `1px solid ${border}`
            : undefined,
        borderBottom: row.kind === "grand" ? `3px double ${border}` : undefined,
      }}
    >
      {cell(
        <Typography.Text type="secondary">{row.code ?? ""}</Typography.Text>,
      )}
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
      code: l.code,
      label: label(l.key),
      amount: l.amount,
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
