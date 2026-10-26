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
import {
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
import { fmtRp, fmtDate, fmtNone, fmtTime } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import { accountOfMethod, balancesOf } from "../../lib/accounts.js";
import { paymentsOf } from "../../lib/salePayments.js";
import { returnedDebts } from "../../lib/saleStatus.js";
import { mutate, useDb } from "../../mock/store.js";
import {
  adjustmentDeletionBlock,
  deleteAdjustment,
  transferPartner,
  type AdjustmentRef,
} from "../../lib/adjustmentDeletion.js";
import {
  EXPENSE_CATEGORIES,
  INCOME_REASONS,
  type Order,
} from "../../mock/seed.js";
import { labelOf } from "../../i18n/enumLabels.js";
import { useTranslation } from "react-i18next";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { DonutChart } from "../../components/DonutChart";
import { expenseBreakdown, monthlyFlow } from "../../lib/cashflowCharts.js";

/** Category label maps, derived from `seed.ts` so there is one vocabulary. */
const INCOME_REASON: Record<string, string> = Object.fromEntries(
  INCOME_REASONS.map((r) => [r.value, r.label]),
);
const EXPENSE_KIND: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
);

type Direction = "INCOME" | "EXPENSE";

/** What a row is, once every source has been reduced to it. */
interface Row {
  readonly key: string;
  readonly at: string;
  readonly direction: Direction;
  /** An `IncomeReason` or an `ExpenseKind`, per `direction`. */
  readonly category: string;
  /** How the money moved, spelled for a human. */
  readonly method: string;
  /** The `PaymentMethod` code behind `method` — what decides the pot. */
  readonly methodCode: string;
  /**
   * False when the money never passed through the shop's cash or bank
   * (`inBalance`, owner answer 2026-09-22). Listed, so the debt it settled
   * has a line; never counted, so the balance says what is really held.
   */
  readonly inBalance: boolean;
  readonly description: string;
  /** The order's code, when a row belongs to a sale or an invoice. */
  readonly orderCode?: string;
  /** Always positive. `direction` is the sign. */
  readonly amount: number;
  /**
   * The two `…_RETURNED` are a sale's debt a return cancelled — voided
   * income, listed and never counted (`isVoided`).
   */
  readonly status:
    "SETTLED" | "PENDING" | "DUE" | "UNPAID_RETURNED" | "PARTLY_PAID_RETURNED";
  /**
   * Orders rows that share an instant — and every hand-typed row of one day
   * does, since an adjustment carries a date and no time: when it was typed
   * (`createdAt`), empty for everything else.
   */
  readonly tie: string;
  /** The `Expense` / `ManualIncome` behind a typed row — what Delete removes. */
  readonly adjustment?: AdjustmentRef & { readonly date: string };
}

/** A debt a return cancelled: listed in Accrual, never counted anywhere. */
const isVoided = (r: Row) =>
  r.status === "UNPAID_RETURNED" || r.status === "PARTLY_PAID_RETURNED";

/**
 * When a typed row happened: the day somebody picked, at the clock time they
 * typed it (owner ask 2026-10-24: an hour and minute on every row). The day is
 * theirs to back-date; the time is the only one there is. A row with no
 * `createdAt` sits at noon, so it sorts among the day's sales rather than
 * always above them — midnight would be a claim it does not make.
 */
function typedAt(date: string, createdAt: string | undefined): string {
  const typed = createdAt === undefined ? undefined : new Date(createdAt);
  if (typed === undefined || Number.isNaN(typed.getTime()))
    return `${date}T12:00:00.000Z`;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(
    y,
    m - 1,
    d,
    typed.getHours(),
    typed.getMinutes(),
    typed.getSeconds(),
    typed.getMilliseconds(),
  ).toISOString();
}

/**
 * Oldest first, and TOTAL: by instant, then by `tie`, then by key.
 *
 * ⚠️ Without the last two the order of a day's typed rows was whatever order
 * the collections happened to hold them in, and the table — sorted newest
 * first by a stable sort — kept them in that same order, oldest on top. So
 * the "Latest balance" on the first row of a busy day was not the latest: on
 * 2026-10-24 it read Rp 21.722.500 above two expenses that had already taken
 * it to Rp 21.622.200, and the shop counted the Rp 100.300 as missing (owner
 * report, 2026-10-24). The table now sorts on this order's position, so the
 * walk and the view cannot disagree.
 */
function chronological(a: Row, b: Row): number {
  return (
    a.at.localeCompare(b.at) ||
    a.tie.localeCompare(b.tie) ||
    a.key.localeCompare(b.key)
  );
}

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

  /** Method-code → the human label from `PaymentMethod.label`. */
  const methodLabel = (code: string) =>
    db.paymentMethods.find((m) => m.code === code)?.label ?? code;
  /** The receipt an adjustment names, where its category needs one. */
  const orderCodeOf = (id?: string) =>
    id === undefined ? undefined : db.orders.find((o) => o.id === id)?.code;

  /**
   * Every movement, from every source, reduced to `Row`.
   *
   * A `Payment` is a row, a `SaleRefund` is a row, a `ManualIncome` is a row,
   * an `Expense` is a row. Aggregating a split sale into one lump is the shape
   * this used to have and it was wrong the way half-cash-half-Shopee is wrong:
   * two facts about one receipt reported as one.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const debts = returnedDebts(db.orders, db.events, db.stockMoves);
    for (const o of db.orders) {
      /*
       * What a return cancelled of this sale's debt — at the sale, where the
       * DUE row it replaces stood. No method: nothing moved, and naming the
       * one a shortfall row defaults to would put it in a pot.
       */
      const voided = debts.get(o.id);
      if (voided !== undefined && voided.cancelled > 0) {
        out.push({
          key: `rd-${o.id}`,
          at: o.ts,
          direction: "INCOME",
          category: "SALES",
          method: fmtNone(),
          methodCode: "",
          inBalance: false,
          description: saleDescription(o, t),
          orderCode: o.code,
          amount: voided.cancelled,
          status: voided.paid > 0 ? "PARTLY_PAID_RETURNED" : "UNPAID_RETURNED",
          tie: "",
        });
      }
      for (const p of paymentsOf(o)) {
        out.push({
          key: `p-${o.id}-${p.id}`,
          at: p.at,
          direction: "INCOME",
          category: "SALES",
          method: methodLabel(p.method),
          methodCode: p.method,
          inBalance: p.inBalance !== false,
          description: saleDescription(o, t),
          orderCode: o.code,
          amount: p.amount,
          status: p.state,
          tie: "",
        });
      }
      for (const r of o.refunds ?? []) {
        out.push({
          key: `rf-${o.id}-${r.id}`,
          at: r.at,
          direction: "EXPENSE",
          category: "REFUND",
          method: methodLabel(r.method),
          methodCode: r.method,
          inBalance: true,
          description:
            r.note?.trim() ||
            t("cashflow.refundOnSale", "Refund on sale {{code}}", {
              code: o.code,
            }),
          orderCode: o.code,
          amount: r.amount,
          status: "SETTLED",
          tie: "",
        });
      }
    }
    for (const i of db.incomes) {
      out.push({
        key: `i-${i.id}`,
        at: typedAt(i.date, i.createdAt),
        direction: "INCOME",
        category: i.reason,
        method: methodLabel(i.method),
        methodCode: i.method,
        inBalance: true,
        description: i.note?.trim() || labelOf(INCOME_REASON, i.reason, t),
        ...(orderCodeOf(i.orderId)
          ? { orderCode: orderCodeOf(i.orderId)! }
          : {}),
        amount: i.amount,
        status: "SETTLED",
        tie: i.createdAt ?? "",
        adjustment: { kind: "income", id: i.id, date: i.date },
      });
    }
    for (const e of db.expenses) {
      out.push({
        key: `e-${e.id}`,
        at: typedAt(e.date, e.createdAt),
        direction: "EXPENSE",
        category: e.kind,
        method: methodLabel(e.method),
        methodCode: e.method,
        inBalance: true,
        description:
          e.label ?? e.note?.trim() ?? labelOf(EXPENSE_KIND, e.kind, t),
        ...(orderCodeOf(e.orderId)
          ? { orderCode: orderCodeOf(e.orderId)! }
          : {}),
        amount: e.amount,
        status: "SETTLED",
        tie: e.createdAt ?? "",
        adjustment: { kind: "expense", id: e.id, date: e.date },
      });
    }
    /*
     * Money paid to suppliers. A deposit is the day the money left; a payment
     * allocated OUT of one moved nothing that day, and counting it again would
     * spend the deposit twice (`lib/accounts.ts`).
     */
    const supplierName = (id: string) =>
      db.suppliers.find((x) => x.id === id)?.name ||
      t("utang.noSupplier", "No supplier named");
    for (const po of db.pos) {
      for (const p of po.payments) {
        if (p.fromDepositId) continue;
        out.push({
          key: `pp-${po.id}-${p.id}`,
          at: p.at,
          direction: "EXPENSE",
          category: "SUPPLIER",
          method: methodLabel(p.method),
          methodCode: p.method,
          inBalance: p.inBalance !== false,
          description: t("cashflow.paidTo", "Paid to {{name}}", {
            name: supplierName(po.supplierId),
          }),
          orderCode: po.code,
          amount: p.amount,
          status: "SETTLED",
          tie: "",
        });
      }
    }
    for (const d of db.deposits) {
      out.push({
        key: `dep-${d.id}`,
        at: d.at,
        direction: "EXPENSE",
        category: "SUPPLIER",
        method: methodLabel(d.method),
        methodCode: d.method,
        inBalance: d.inBalance !== false,
        description:
          d.note?.trim() ||
          t("cashflow.depositWith", "Deposit with {{name}}", {
            name: supplierName(d.supplierId),
          }),
        amount: d.amount,
        status: "SETTLED",
        tie: "",
      });
    }
    // Payments off a debt from before this app. Customers only since
    // 2026-09-24: a supplier's old debt is no longer recorded at all.
    for (const c of db.customers) {
      for (const p of c.openingPayments ?? []) {
        out.push({
          key: `cop-${c.id}-${p.id}`,
          at: p.at,
          direction: "INCOME",
          category: "SALES",
          method: methodLabel(p.method),
          methodCode: p.method,
          inBalance: p.inBalance !== false,
          description:
            p.note?.trim() ||
            t("cashflow.oldDebtTo", "{{name}} — debt from before this app", {
              name: customerLabel(c),
            }),
          amount: p.amount,
          status: "SETTLED",
          tie: "",
        });
      }
    }
    // Newest first, so the top of the page is what happened last.
    return out.sort((a, b) => chronological(b, a));
  }, [
    db.orders,
    db.events,
    db.stockMoves,
    db.incomes,
    db.expenses,
    db.pos,
    db.deposits,
    db.suppliers,
    db.customers,
    db.paymentMethods,
    t,
  ]);

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
  const deleteBlockText = (r: Row) =>
    r.adjustment &&
    adjustmentDeletionBlock(r.adjustment.date, db.settings) === "BOOKS_CLOSED"
      ? t(
          "cashflow.deleteClosed",
          "The book is closed over this month. Reopen it to delete this adjustment.",
        )
      : undefined;

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
  const pots = useMemo(() => {
    const from = db.settings.openingBalanceAt ?? "";
    return balancesOf(
      rows
        .filter(
          (r) =>
            r.inBalance &&
            !isVoided(r) &&
            r.at >= from &&
            (basis === "ACCRUAL" || r.status === "SETTLED"),
        )
        .map((r) => ({
          method: r.methodCode,
          amount: r.direction === "INCOME" ? r.amount : -r.amount,
        })),
      {
        cash: db.settings.openingCash ?? 0,
        bank: db.settings.openingBank ?? 0,
      },
    );
  }, [
    rows,
    basis,
    db.settings.openingCash,
    db.settings.openingBank,
    db.settings.openingBalanceAt,
  ]);

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

/** Auto-generate a description for a movement rooted in a sale. */
function saleDescription(
  o: Order,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return t("cashflow.saleDescription", "Sale via {{channel}}", {
    channel: o.source.toLowerCase(),
  });
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
