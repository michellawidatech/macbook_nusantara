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
 * `AdjustmentPanel` still owns the write path: an expense goes into
 * `db.expenses`, an income into `db.incomes`.
 */
import { useMemo, useState } from "react";
import { Button, Card, Flex, Segmented, Tag, Typography } from "antd";
import {
  BankOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { OpeningBalanceModal } from "./OpeningBalanceModal";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { AdjustmentPanel } from "./AdjustmentPanel";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import { accountOfMethod, balancesOf } from "../../lib/accounts.js";
import { paymentsOf } from "../../lib/salePayments.js";
import { useDb } from "../../mock/store.js";
import {
  EXPENSE_CATEGORIES,
  INCOME_REASONS,
  type Order,
} from "../../mock/seed.js";
import { labelOf } from "../../i18n/enumLabels.js";
import { useTranslation } from "react-i18next";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

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
  readonly status: "SETTLED" | "PENDING" | "DUE";
}

export function IncomeExpensePage() {
  const { t } = useTranslation();
  const db = useDb();
  const [addAdjustment, setAddAdjustment] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [basis, setBasis] = useState<"CASH" | "ACCRUAL">("CASH");
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
    for (const o of db.orders) {
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
        });
      }
    }
    for (const i of db.incomes) {
      out.push({
        key: `i-${i.id}`,
        // Noon so the row sorts among the day's sales rather than always above
        // them; a hand-entered row carries a date and no time, and pretending
        // it happened at midnight is a claim it does not make.
        at: `${i.date}T12:00:00.000Z`,
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
      });
    }
    for (const e of db.expenses) {
      out.push({
        key: `e-${e.id}`,
        at: `${e.date}T12:00:00.000Z`,
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
        });
      }
    }
    // Newest first, so the top of the page is what happened last.
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [
    db.orders,
    db.incomes,
    db.expenses,
    db.pos,
    db.deposits,
    db.suppliers,
    db.customers,
    db.paymentMethods,
    t,
  ]);

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
    const chronological = [...rows].sort((a, b) => a.at.localeCompare(b.at));
    const opening =
      (db.settings.openingCash ?? 0) + (db.settings.openingBank ?? 0);
    let running = opening;
    // The opening figure already holds everything settled before its date.
    const from = db.settings.openingBalanceAt ?? "";
    const at = new Map<string, number>();
    for (const r of chronological) {
      if (
        r.status === "SETTLED" &&
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
              dateRange: true,
              facetLabel: t("finance.date", "Date"),
              render: (v: string) => fmtDate(v),
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
                  type={r.direction === "INCOME" ? "success" : "danger"}
                  strong
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
                  {(!r.inBalance || !accountOfMethod(r.methodCode)) && (
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
  }
}
