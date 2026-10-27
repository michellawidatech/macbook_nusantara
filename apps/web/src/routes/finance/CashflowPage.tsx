/**
 * Income & Expense — one table, every movement of money.
 *
 * ## Type · Category · Method (owner, 2026-09-23)
 *
 * > *"Separate the type and the payment method to different column, the type
 * > is either income or expense."*
 *
 * Three questions, three columns: which way the money went, what it was for,
 * and how it moved. They used to be one cell reading "Expense · Bank
 * transfer", which could not be filtered on either half.
 *
 * The categories are the owner's own list and live in `mock/seed.ts` beside
 * the enum values — the same list the adjustment dialog offers, so a row this
 * page derives from a sale and a row somebody types are named the same thing.
 *
 * ## Two bases
 *
 * **Cash basis** (the default) shows money that has actually moved. **Accrual**
 * adds what a marketplace is holding and what a customer owes. The running
 * balance is the same figure in both — it counts settled movements only, which
 * is what "the real balance" means (owner answer 2026-09-23).
 *
 * ## A debt a return cancelled (owner ask 2026-10-26)
 *
 * An unpaid sale that comes back has its DUE row cut by the return, and the
 * row used to vanish from Accrual as if the debt had never been. It stays as
 * ONE row for what the return cancelled (`returnedDebts`, read off what is
 * stored): dated at the sale, struck through, tagged "Unpaid, returned" or
 * "Partly paid, returned" — and never counted, in the running balance, the
 * Cash and Bank cards or the two charts. It is a record that the income was
 * voided, not money. Cash basis does not list it, as it lists no DUE row.
 *
 * `AdjustmentPanel` still owns the write path: an expense goes into
 * `db.expenses`, an income into `db.incomes`.
 */
import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Segmented,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BankOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { OpeningBalanceModal } from "./OpeningBalanceModal";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { AdjustmentPanel } from "./AdjustmentPanel";
import {
  fmtRp,
  fmtDate,
  fmtMonth,
  fmtNone,
  fmtTime,
} from "../../lib/format.js";
import { accountOfMethod } from "../../lib/accounts.js";
import {
  EXPENSE_KIND_LABEL,
  INCOME_REASON_LABEL,
  balancesOfRows,
  cashflowRows,
  isVoided,
  type CashflowRow,
  type Direction,
} from "../../lib/cashflowRows.js";
import { mutate, useDb } from "../../mock/store.js";
import {
  adjustmentDeletionBlock,
  adjustmentReconciliationBlock,
  deleteAdjustment,
  transferPartner,
} from "../../lib/adjustmentDeletion.js";
import { unreconciledPots } from "../../lib/reconciliation.js";
import { labelOf } from "../../i18n/enumLabels.js";
import { useTranslation } from "react-i18next";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { DonutChart } from "../../components/DonutChart";
import { expenseBreakdown, monthlyFlow } from "../../lib/cashflowCharts.js";

const INCOME_REASON = INCOME_REASON_LABEL;
const EXPENSE_KIND = EXPENSE_KIND_LABEL;
type Row = CashflowRow;

export function IncomeExpensePage() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const db = useDb();
  const [addAdjustment, setAddAdjustment] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [basis, setBasis] = useState<"CASH" | "ACCRUAL">("CASH");
  /** How far back the two charts look (owner ask 2026-10-23). */
  const [chartMonths, setChartMonths] = useState<3 | 6 | 12>(6);
  /**
   * The two balances are hidden until somebody asks (owner ask 2026-10-22:
   * *"the balance should be dotted at first and if they want to see it they
   * can open the eye button"*) — the screen is often in view of a customer.
   * Per visit, never remembered.
   */
  const [reveal, setReveal] = useState<{ cash: boolean; bank: boolean }>({
    cash: false,
    bank: false,
  });

  /**
   * Every movement, from every source, reduced to `Row` — the projection
   * Reconciliation counts as well (`lib/cashflowRows.ts`).
   */
  const rows = useMemo<Row[]>(
    () => cashflowRows(db, t),
    [
      db.orders,
      db.events,
      db.stockMoves,
      db.incomes,
      db.expenses,
      db.returns,
      db.pos,
      db.deposits,
      db.suppliers,
      db.customers,
      db.paymentMethods,
      t,
    ],
  );

  /**
   * Each row's place in the one total order, newest highest — what the Date
   * column sorts on, so either direction is exactly the order the running
   * balance was walked in (see `chronological`).
   */
  const position = useMemo(
    () => new Map(rows.map((r, i) => [r.key, rows.length - i])),
    [rows],
  );

  /** Why a typed row cannot be deleted, in words; undefined when it can. */
  const deleteBlockText = (r: Row) => {
    if (!r.adjustment) return undefined;
    if (
      adjustmentDeletionBlock(r.adjustment.date, db.settings) === "BOOKS_CLOSED"
    )
      return t(
        "cashflow.deleteClosed",
        "The book is closed over this month. Reopen it to delete this adjustment.",
      );
    // A closed reconciliation names it (2026-10-27): reopen that first.
    const rec = adjustmentReconciliationBlock(db, r.adjustment);
    if (rec === undefined) return undefined;
    return rec.kind === "MONTHLY"
      ? t(
          "cashflow.deleteReconciledMonth",
          "The bank reconciliation of {{month}} matched this row. Reopen that reconciliation first.",
          { month: fmtMonth(rec.periodStart) },
        )
      : t(
          "cashflow.deleteReconciledDay",
          "The {{pot}} reconciliation of {{day}} recorded this row. Reopen that reconciliation first.",
          {
            pot:
              rec.pot === "BANK"
                ? t("recon.bank", "Bank")
                : t("recon.cash", "Cash"),
            day: fmtDate(rec.periodStart),
          },
        );
  };

  /** Today's pots nobody has counted yet (2026-10-27). */
  const today = dayjs().format("YYYY-MM-DD");
  const uncounted = unreconciledPots(db, today);

  /*
   * Delete a typed adjustment (owner ask 2026-10-24). A cash ↔ bank move goes
   * with its other half; `lib/adjustmentDeletion.ts` is the rule.
   */
  const removeAdjustment = (r: Row) => {
    const ref = r.adjustment;
    if (!ref) return;
    const pair = transferPartner(db, ref) !== undefined;
    modal.confirm({
      title: t("cashflow.deleteTitle", "Delete this adjustment?"),
      content: pair
        ? t(
            "cashflow.deleteMoveBody",
            "{{description}} — {{amount}}. Both halves of this cash ↔ bank move are removed for good, and the balances are worked out again without them.",
            { description: r.description, amount: fmtRp(r.amount) },
          )
        : t(
            "cashflow.deleteBody",
            "{{description}} — {{amount}}. It is removed for good, and the balances are worked out again without it.",
            { description: r.description, amount: fmtRp(r.amount) },
          ),
      okText: t("cashflow.deleteOk", "Delete adjustment"),
      okButtonProps: { danger: true },
      onOk: () => {
        let removed = 0;
        mutate((d) => {
          removed = deleteAdjustment(d, ref);
        });
        if (removed > 0)
          message.success(t("cashflow.deleted", "Adjustment deleted."));
      },
    });
  };

  /** Cash basis is money that moved; accrual adds what is promised. */
  const shown = useMemo(
    () =>
      basis === "CASH" ? rows.filter((r) => r.status === "SETTLED") : rows,
    [rows, basis],
  );

  /**
   * The running balance beside each row — every SETTLED movement from the top
   * of time up to and including this one.
   *
   * Walked OLDEST first and then indexed by key: the table is drawn
   * newest-first, but each row's balance is "what was in the bank after this
   * happened", not "what remained above". Built from `rows` rather than from
   * what is shown, so switching basis does not change the figure.
   */
  const balanceAtRow = useMemo(() => {
    const opening =
      (db.settings.openingCash ?? 0) + (db.settings.openingBank ?? 0);
    let running = opening;
    // The opening figure already holds everything settled before its date.
    const from = db.settings.openingBalanceAt ?? "";
    const at = new Map<string, number>();
    // `rows` is newest first in the one total order; walk it backwards.
    for (const r of [...rows].reverse()) {
      if (
        r.status === "SETTLED" &&
        !isVoided(r) &&
        r.inBalance &&
        accountOfMethod(r.methodCode) &&
        r.at >= from
      )
        running += r.direction === "INCOME" ? r.amount : -r.amount;
      at.set(r.key, running);
    }
    return at;
  }, [
    rows,
    db.settings.openingCash,
    db.settings.openingBank,
    db.settings.openingBalanceAt,
  ]);

  /**
   * What is in the drawer and in the bank (owner ask 2026-10-22: *"why can't I
   * see the total cash in bank and the petty cash"*), on the basis the switch
   * says: cash basis is money that moved; accrual adds what is promised — a
   * marketplace payout still pending counts toward the bank, a customer's
   * debt toward the pot its method names. From the opening balance on.
   */
  const pots = useMemo(
    () => balancesOfRows(rows, db.settings, { accrual: basis === "ACCRUAL" }),
    [rows, basis, db.settings],
  );

  const potCard = (
    which: "cash" | "bank",
    title: string,
    icon: React.ReactNode,
  ) => (
    <Card size="small" style={{ flex: "1 1 240px" }}>
      <Flex justify="space-between" align="center" gap={SPACE.sm}>
        <Flex vertical gap={0}>
          <Typography.Text type="secondary">
            {icon} {title}
          </Typography.Text>
          <Typography.Text
            strong
            style={{ fontSize: TYPE.lg }}
            data-testid={`pot-${which}`}
          >
            {reveal[which] ? fmtRp(pots[which]) : "Rp ••••••"}
          </Typography.Text>
        </Flex>
        <Button
          type="text"
          icon={reveal[which] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          aria-label={
            reveal[which]
              ? t("cashflow.hideBalance", "Hide {{what}}", { what: title })
              : t("cashflow.showBalance", "Show {{what}}", { what: title })
          }
          onClick={() => setReveal((r) => ({ ...r, [which]: !r[which] }))}
        />
      </Flex>
    </Card>
  );

  /*
   * The two charts (owner ask 2026-10-23), off the rows the table shows — so
   * the basis switch moves them too — over the last 3, 6 or 12 months.
   */
  const charted = useMemo(() => shown.filter((r) => !isVoided(r)), [shown]);
  const trend = useMemo(
    () => monthlyFlow(charted, new Date(), chartMonths),
    [charted, chartMonths],
  );
  const slices = useMemo(
    () => expenseBreakdown(charted, trend[0]!.month),
    [charted, trend],
  );
  const fmtShort = (n: number) =>
    Math.abs(n) >= 1_000_000
      ? `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`
      : fmtRp(n);

  const typeLabel = (d: Direction) =>
    d === "INCOME"
      ? t("finance.income", "Income")
      : t("finance.expense", "Expense");
  const categoryLabel = (r: Row) =>
    r.direction === "INCOME"
      ? labelOf(INCOME_REASON, r.category, t)
      : labelOf(EXPENSE_KIND, r.category, t);

  return (
    <PageContainer
      title={t("finance.incomeExpense", "Income & Expense")}
      stickyHeader
      actions={[
        {
          key: "opening",
          label: t("opening.title", "Opening balance"),
          icon: <BankOutlined />,
          onClick: () => setOpeningOpen(true),
        },
        {
          key: "add",
          label: t("finance.addAdjustment", "Add adjustment"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAddAdjustment(true),
        },
      ]}
    >
      {uncounted.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: SPACE.md }}
          data-testid="today-unreconciled"
          title={
            <span>
              {t("cashflow.todayUnreconciled", "Today isn't reconciled")}
              {" — "}
              <Link to="/finance/reconciliation?reconcile=today">
                {t("recon.reconcile", "Reconcile")}
              </Link>
            </span>
          }
        />
      )}
      <Flex gap={SPACE.md} wrap style={{ marginBottom: SPACE.md }}>
        {potCard("cash", t("cashflow.cashPot", "Cash"), <WalletOutlined />)}
        {potCard("bank", t("cashflow.bankPot", "Bank"), <BankOutlined />)}
      </Flex>
      <Flex gap={SPACE.md} wrap style={{ marginBottom: SPACE.md }}>
        <Card
          size="small"
          style={{ flex: "2 1 520px", minWidth: 0 }}
          title={t("cashflow.trendTitle", "Revenue vs. expense")}
          extra={
            <Segmented<3 | 6 | 12>
              size="small"
              value={chartMonths}
              onChange={setChartMonths}
              options={[
                { value: 3, label: t("cashflow.months3", "3 months") },
                { value: 6, label: t("cashflow.months6", "6 months") },
                { value: 12, label: t("cashflow.months12", "12 months") },
              ]}
            />
          }
        >
          <TimeSeriesChart
            categories={trend.map((m) =>
              m.month.toLocaleDateString(undefined, {
                month: "short",
                year: "2-digit",
              }),
            )}
            series={[
              {
                key: "income",
                label: t("cashflow.revenue", "Revenue"),
                values: trend.map((m) => m.income),
              },
              {
                key: "expense",
                label: t("cashflow.expenses", "Expenses"),
                values: trend.map((m) => m.expense),
              },
            ]}
            format={fmtRp}
            formatTick={fmtShort}
            height={240}
          />
        </Card>
        <Card
          size="small"
          style={{ flex: "1 1 380px", minWidth: 0 }}
          title={t("cashflow.breakdownTitle", "Expense breakdown")}
        >
          <DonutChart
            slices={slices.map((s) => ({
              key: s.category,
              label:
                s.category === "OTHER"
                  ? t("cashflow.otherExpenses", "Other")
                  : labelOf(EXPENSE_KIND, s.category, t),
              value: s.amount,
              other: s.category === "OTHER",
            }))}
            format={fmtRp}
            centre={fmtShort(slices.reduce((n, s) => n + s.amount, 0))}
            size={180}
            emptyText={t("cashflow.noExpenses", "No expense in this period.")}
          />
        </Card>
      </Flex>
      <Card>
        <ProTable<Row>
          persistKey="cashflow.unified"
          rowKey="key"
          dataSource={shown}
          searchPlaceholder={t(
            "cashflow.searchOrderOrDescription",
            "Search a transaction, a description or a method",
          )}
          toolbar={
            <Segmented<"CASH" | "ACCRUAL">
              value={basis}
              onChange={setBasis}
              options={[
                { value: "CASH", label: t("finance.cashBasis", "Cash basis") },
                { value: "ACCRUAL", label: t("finance.accrual", "Accrual") },
              ]}
            />
          }
          columns={[
            {
              title: t("finance.date", "Date"),
              dataIndex: "at",
              width: COLUMN.date,
              defaultSortOrder: "descend",
              sortValue: (r: Row) => position.get(r.key),
              dateRange: true,
              dateValue: (r: Row) => r.at,
              facetLabel: t("finance.date", "Date"),
              render: (v: string) => (
                <Flex vertical>
                  <span>{fmtDate(v)}</span>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {fmtTime(v)}
                  </Typography.Text>
                </Flex>
              ),
            },
            {
              title: t("finance.type", "Type"),
              key: "type",
              width: COLUMN.status,
              facet: true,
              facetLabel: t("finance.type", "Type"),
              facetValue: (r: Row) => typeLabel(r.direction),
              sortValue: (r: Row) => typeLabel(r.direction),
              render: (_: unknown, r: Row) => (
                <Tag color={r.direction === "INCOME" ? "green" : "red"}>
                  {typeLabel(r.direction)}
                </Tag>
              ),
            },
            {
              title: t("finance.category", "Category"),
              key: "category",
              width: 200,
              facet: true,
              facetLabel: t("finance.category", "Category"),
              facetValue: categoryLabel,
              sortValue: categoryLabel,
              render: (_: unknown, r: Row) => categoryLabel(r),
            },
            {
              title: t("finance.method", "Payment method"),
              key: "method",
              width: COLUMN.status,
              facet: true,
              facetLabel: t("finance.method", "Payment method"),
              facetValue: (r: Row) => r.method,
              sortValue: (r: Row) => r.method,
              render: (_: unknown, r: Row) => r.method,
            },
            {
              title: t("finance.description", "Description"),
              dataIndex: "description",
              searchable: true,
              render: (v: string) => v || fmtNone(),
            },
            {
              title: t("finance.transactionId", "Transaction ID"),
              dataIndex: "orderCode",
              width: COLUMN.code,
              searchable: true,
              render: (v?: string) => v ?? fmtNone(),
            },
            {
              title: t("finance.amount", "Amount"),
              key: "amount",
              width: COLUMN.money,
              align: "right",
              sortValue: (r: Row) =>
                r.direction === "INCOME" ? r.amount : -r.amount,
              render: (_: unknown, r: Row) => (
                <Typography.Text
                  type={
                    isVoided(r)
                      ? "secondary"
                      : r.direction === "INCOME"
                        ? "success"
                        : "danger"
                  }
                  strong={!isVoided(r)}
                  delete={isVoided(r)}
                  data-voided={isVoided(r) ? "true" : undefined}
                >
                  {r.direction === "INCOME" ? "+" : "−"}
                  {fmtRp(r.amount)}
                </Typography.Text>
              ),
            },
            {
              title: t("finance.status", "Status"),
              dataIndex: "status",
              width: COLUMN.status,
              facet: true,
              facetLabel: t("finance.status", "Status"),
              facetValue: (r: Row) => statusLabel(r.status, t),
              render: (v: Row["status"], r: Row) => (
                <span>
                  <Tag color={statusColour(v)}>{statusLabel(v, t)}</Tag>
                  {/* Either because somebody said so (`inBalance`) or because
                      the method belongs to no pot — a transfer from an account
                      this app does not keep. Both mean the same thing on this
                      row, so they say the same word. */}
                  {!isVoided(r) &&
                    (!r.inBalance || !accountOfMethod(r.methodCode)) && (
                      <Tag>{t("cashflow.notInBalance", "Not in balance")}</Tag>
                    )}
                </span>
              ),
            },
            {
              title: t("finance.latestBalance", "Latest balance"),
              key: "balance",
              width: COLUMN.money,
              align: "right",
              render: (_: unknown, r: Row) => {
                const b = balanceAtRow.get(r.key);
                return b === undefined ? fmtNone() : fmtRp(b);
              },
            },
            {
              key: "actions",
              width: COLUMN.action,
              align: "center",
              render: (_: unknown, r: Row) =>
                r.adjustment ? (
                  <Tooltip
                    title={
                      deleteBlockText(r) ??
                      t("cashflow.deleteAdjustment", "Delete adjustment")
                    }
                  >
                    <span>
                      <Button
                        size="small"
                        danger
                        disabled={deleteBlockText(r) !== undefined}
                        aria-label={t(
                          "cashflow.deleteAdjustmentAria",
                          "Delete {{description}}",
                          { description: r.description },
                        )}
                        icon={<DeleteOutlined />}
                        onClick={() => removeAdjustment(r)}
                      />
                    </span>
                  </Tooltip>
                ) : null,
            },
          ]}
        />
      </Card>

      <AdjustmentPanel
        addOpen={addAdjustment}
        onCloseAdd={() => setAddAdjustment(false)}
        showHistory={false}
      />
      <OpeningBalanceModal
        open={openingOpen}
        onClose={() => setOpeningOpen(false)}
      />
    </PageContainer>
  );
}

/** A short user-facing label per row status. */
function statusLabel(
  s: Row["status"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (s) {
    case "SETTLED":
      return t("finance.statusSettled", "Settled");
    case "PENDING":
      return t("finance.statusPending", "Pending");
    case "DUE":
      return t("finance.statusDue", "Owed");
    case "UNPAID_RETURNED":
      return t("finance.statusUnpaidReturned", "Unpaid, returned");
    case "PARTLY_PAID_RETURNED":
      return t("finance.statusPartPaidReturned", "Partly paid, returned");
  }
}

/** The antd Tag colour for each status. */
function statusColour(s: Row["status"]): string {
  switch (s) {
    case "SETTLED":
      return "green";
    case "PENDING":
      return "orange";
    case "DUE":
      return "red";
    case "UNPAID_RETURNED":
    case "PARTLY_PAID_RETURNED":
      return "purple";
  }
}
