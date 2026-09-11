/**
 * Income & Expense — money in, money out, and marketplace money still in escrow.
 *
 * Four sections, in the order somebody opening this page wants them:
 *  1. What the business holds, and the same figures over a window.
 *  2. What is still owed to us, per marketplace — one card with a channel
 *     picker (owner ask 2026-09-01).
 *  3. Is the advertising working (marketing spend scored against the customers
 *     who said they came from that channel).
 *  4. The adjustments somebody typed, and every movement in one list.
 *
 * ## The chart is gone (owner ask 2026-09-01)
 *
 * "Money over time" was a 90-day line chart of income, expenses, net and
 * pending. It was removed at the owner's request, and the request is sound
 * for this shop: with a handful of sales a day the daily buckets were mostly
 * zero, so the line said "quiet Tuesday" rather than anything about the
 * business, and the two cards above it answer the question it was reaching
 * for — what is the balance, and what did the last N days do to it — with
 * numbers somebody can act on.
 *
 * The component it drew with, `components/TimeSeriesChart.tsx`, is still there
 * and now has no callers. It is generic and dependency-free, so it was left in
 * place for a future report screen rather than deleted; its own header says so.
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  Modal,
  Segmented,
  Select,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { AdjustmentPanel } from "./AdjustmentPanel";
import { fmtRp, fmtDateTime, fmtDate } from "../../lib/format.js";
import { balancesOf, type Movement } from "../../lib/accounts.js";
import { paymentsOf } from "../../lib/salePayments.js";
import { useDb, mutate } from "../../mock/store.js";
import {
  EXPENSE_CATEGORIES,
  INCOME_REASONS,
  type Order,
} from "../../mock/seed.js";
import { labelOf } from "../../i18n/enumLabels.js";
import { SPACE, TYPE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";

/**
 * Reason labels, derived from `seed.ts` rather than restated, so the movement
 * list and the adjustment history below cannot spell one differently.
 */
const INCOME_REASON: Record<string, string> = Object.fromEntries(
  INCOME_REASONS.map((r) => [r.value, r.label]),
);
const EXPENSE_KIND: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
);

/** Module-level, so the labels are their own catalogue keys — `t()` runs at
 * the render site below. */
const RANGES = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

export function IncomeExpensePage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [withdrawing, setWithdrawing] = useState<Order | null>(null);
  const [wForm] = Form.useForm<{ net: number }>();
  const [addAdjustment, setAddAdjustment] = useState(false);
  /** The opening-balance dialog. See `balance` below. */
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceForm] = Form.useForm<{ cash?: number; bank?: number }>();
  /**
   * The window the period card reads: 0 = today, N = the last N days, -1 =
   * the custom range picked on the calendar (owner ask 2026-08-27).
   */
  const [periodDays, setPeriodDays] = useState(0);
  const [customRange, setCustomRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  /** Which marketplace's pending money is on screen. "ALL" is every one. */
  const [channelFilter, setChannelFilter] = useState<string>("ALL");

  const pending = db.orders.filter((o) => !o.settled);
  const pendingTotal = pending.reduce((t, o) => t + o.total, 0);

  /**
   * The running balance, in the two pots the shop actually keeps it in (owner
   * ask 2026-09-09): what came before the app plus everything it has recorded
   * since, sorted into the drawer and the bank by how each movement moved.
   *
   * ## Why it is built from PAYMENTS and not from order totals
   *
   * It used to be `Σ total of every settled order`, which was the best a
   * boolean could do. A sale is a list of payments now (2026-09-08), and a
   * customer who pays Rp5jt cash and Rp5jt by transfer has put money in both
   * pots off one receipt — a fact `o.total` cannot express whichever pot you
   * assign it to. Summing the payments also drops escrow for free: money a
   * marketplace is holding is a PENDING payment, so it never becomes a
   * movement at all, which is exactly what "not in the bank yet" means.
   *
   * The three opening figures below and `lib/accounts.ts` are the whole of the
   * arithmetic; this page only decides what counts as a movement.
   */
  const settledMovements = useMemo<Movement[]>(() => {
    const rows: Movement[] = [];
    for (const o of db.orders) {
      for (const p of paymentsOf(o)) {
        if (p.state === "SETTLED") {
          rows.push({ method: p.method, amount: p.amount });
        }
      }
    }
    // Money in that no sale accounts for, and money out — both carry the
    // method staff picked, which is the only reason either can be sorted.
    for (const i of db.incomes) rows.push({ method: i.method, amount: i.amount });
    for (const e of db.expenses) {
      rows.push({ method: e.method, amount: -e.amount });
    }
    return rows;
  }, [db.orders, db.incomes, db.expenses]);

  const openingCash = db.settings.openingCash;
  const openingBank = db.settings.openingBank;
  /** True once either pot has been stated. Both unset is the empty state. */
  const hasOpening = openingCash !== undefined || openingBank !== undefined;
  const opened = (openingCash ?? 0) + (openingBank ?? 0);
  const balances = useMemo(
    () => balancesOf(settledMovements, { cash: openingCash, bank: openingBank }),
    [settledMovements, openingCash, openingBank],
  );
  const balance = balances.total;
  /** Nothing recorded at all — the state the "add the balance" button owns. */
  const noDataYet =
    db.orders.length === 0 &&
    db.expenses.length === 0 &&
    db.incomes.length === 0 &&
    !hasOpening;

  const saveOpeningBalance = () =>
    balanceForm.validateFields().then((v) => {
      mutate((d) => {
        // Written even when zero: "we keep no float" is an answer, and an
        // undefined pot would put the card back into its empty state.
        d.settings.openingCash = v.cash ?? 0;
        d.settings.openingBank = v.bank ?? 0;
        d.settings.openingBalanceAt = new Date().toISOString();
      });
      setBalanceOpen(false);
      balanceForm.resetFields();
      message.success(
        t(
          "finance.openingBalanceSaved",
          "Starting balance recorded — the card counts from it now.",
        ),
      );
    });

  /** [from, to] as ISO dates, or null while a custom range is half-picked. */
  const period: [string, string] | null = (() => {
    if (periodDays === -1) {
      const [a, b] = customRange ?? [null, null];
      if (!a || !b) return null;
      return [a.format("YYYY-MM-DD"), b.format("YYYY-MM-DD")];
    }
    if (periodDays === 0) return [today, today];
    const from = new Date(Date.now() - (periodDays - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return [from, today];
  })();
  const inPeriod = (iso: string) =>
    period !== null && iso >= period[0] && iso <= period[1];
  /*
   * The same rule as the balance above, over a window: settled PAYMENTS, not
   * the totals of orders flagged settled.
   *
   * The two have to agree or the card under the balance contradicts it — a
   * half-cash, half-Shopee sale would raise this figure by the whole bill
   * while the balance took only the cash. Dated by the ORDER, because a
   * period on this card means "what did these days do", and a sale belongs to
   * the day it was made.
   */
  const periodIncome =
    db.orders
      .filter((o) => inPeriod(o.ts.slice(0, 10)))
      .reduce(
        (t, o) =>
          t +
          paymentsOf(o)
            .filter((p) => p.state === "SETTLED")
            .reduce((n, p) => n + p.amount, 0),
        0,
      ) +
    db.incomes
      .filter((i) => inPeriod(i.date))
      .reduce((t, i) => t + i.amount, 0);
  const periodExpense = db.expenses
    .filter((e) => inPeriod(e.date))
    .reduce((t, e) => t + e.amount, 0);

  /**
   * Pending money, split by the channel it is sitting in.
   *
   * One total was the wrong shape (owner decision 2026-08-24): "Rp 40jt
   * pending" is not something anyone can chase, because chasing it means going
   * to a specific marketplace's dashboard and pressing withdraw there. Per
   * channel, the number becomes a worklist.
   *
   * Built from the channels actually present rather than from a fixed list, so
   * a channel the shop stops selling on stops appearing instead of sitting at
   * Rp 0 forever.
   */
  const pendingByChannel = Object.entries(
    pending.reduce<Record<string, { total: number; count: number }>>(
      (acc, o) => {
        const key = o.source;
        acc[key] = {
          total: (acc[key]?.total ?? 0) + o.total,
          count: (acc[key]?.count ?? 0) + 1,
        };
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b[1].total - a[1].total);

  /**
   * Which marketplace the pending table is showing (owner ask 2026-09-01).
   *
   * Falls back to "ALL" rather than being reset when the selected channel
   * empties: confirming the last Shopee withdrawal should leave the table
   * showing what is left everywhere, not an empty table headed Shopee. Derived
   * rather than stored so no effect is needed to keep the two in step.
   */
  const channelHasPending = pendingByChannel.some(
    ([c]) => c === channelFilter,
  );
  const activeChannel = channelHasPending ? channelFilter : "ALL";
  const shownPending =
    activeChannel === "ALL"
      ? pending
      : pending.filter((o) => o.source === activeChannel);

  /**
   * Confirm a marketplace withdrawal.
   *
   * The net figure OVERWRITES the sale's total, because after the marketplace
   * takes its commission the net is what the business actually received — and
   * every other number on this page adds up `total`. The original is kept in
   * `grossTotal` so the difference stays visible rather than being quietly
   * absorbed.
   */
  const confirmWithdrawal = () =>
    wForm.validateFields().then((v) => {
      const order = withdrawing!;
      const net = v.net;
      mutate((d) => {
        const o = d.orders.find((x) => x.id === order.id)!;
        if (net !== o.total) {
          o.grossTotal = o.total;
          o.netReceived = net;
          o.total = net;
        }
        o.settled = true;
      });
      const fee = order.total - net;
      message.success(
        fee > 0
          ? `Withdrawal confirmed. ${fmtRp(net)} received — ${fmtRp(fee)} kept by ${order.source.toLowerCase()}.`
          : "Withdrawal confirmed — the money now counts as income.",
      );
      setWithdrawing(null);
    });

  /**
   * Advertising, scored.
   *
   * Attribution here is what the customer said at the till — `referralSourceId`
   * on the order, falling back to the one recorded on the customer. It is
   * self-reported and therefore soft, which the card says out loud: a channel
   * with no spend and plenty of sales is usually a channel people name because
   * they remember it, not one that was paid for.
   */
  const marketing = useMemo(() => {
    const spendBySource = new Map<string, number>();
    for (const e of db.expenses) {
      if (e.kind !== "MARKETING") continue;
      const key = e.referralSourceId ?? "unattributed";
      spendBySource.set(key, (spendBySource.get(key) ?? 0) + e.amount);
    }
    const sourceOf = (o: Order) =>
      o.referralSourceId ??
      db.customers.find((c) => c.id === o.customerId)?.referralSourceId;

    const keys = new Set<string>([
      ...spendBySource.keys(),
      ...db.orders
        .map((o) => sourceOf(o))
        .filter((k): k is string => Boolean(k)),
    ]);

    return [...keys].map((key) => {
      const orders = db.orders.filter((o) => sourceOf(o) === key);
      const spend = spendBySource.get(key) ?? 0;
      const revenue = orders.reduce((t, o) => t + o.total, 0);
      const customers = new Set(orders.map((o) => o.customerId).filter(Boolean))
        .size;
      return {
        key,
        name:
          db.referralSources.find((r) => r.id === key)?.name ??
          "Not attributed",
        spend,
        revenue,
        orders: orders.length,
        customers,
        costPerCustomer:
          customers > 0 && spend > 0 ? Math.round(spend / customers) : null,
        // Return on ad spend. Null rather than Infinity when nothing was spent:
        // "∞×" in a table is a division by zero wearing a costume.
        roas: spend > 0 ? revenue / spend : null,
      };
    });
  }, [db.expenses, db.orders, db.customers, db.referralSources]);

  const totalAdSpend = marketing.reduce((t, m) => t + m.spend, 0);

  /**
   * Every movement of money, in one list.
   *
   * Three sources now, not two: hand-entered income joined the ledger on
   * 2026-09-01 and has to be here, or the balance above would count money
   * this table cannot show — which is exactly the kind of disagreement that
   * makes somebody stop trusting the figure.
   */
  const movements = [
    ...db.orders.map((o) => ({
      key: `o-${o.id}`,
      at: o.ts,
      what: `Sale ${o.code} (${o.source.toLowerCase()})`,
      kind: t("finance.kindSale", "Sale"),
      in: o.settled ? o.total : 0,
      out: 0,
      pending: !o.settled,
    })),
    ...db.incomes.map((i) => ({
      key: `i-${i.id}`,
      // Noon rather than midnight, so a hand-entered row sorts among the
      // day's sales rather than always above them. It carries a date and no
      // time, and pretending it happened at 00:00 is a claim it does not make.
      at: `${i.date}T12:00:00.000Z`,
      what:
        i.note?.trim() ||
        labelOf(INCOME_REASON, i.reason, t),
      kind: t("finance.kindIncome", "Income"),
      in: i.amount,
      out: 0,
      pending: false,
    })),
    ...db.expenses.map((e) => ({
      key: `e-${e.id}`,
      at: `${e.date}T12:00:00.000Z`,
      // A row typed through the adjustment dialog has no label — the reason
      // and the note are what it has. See `Expense.label`.
      what: e.label ?? e.note?.trim() ?? labelOf(EXPENSE_KIND, e.kind, t),
      kind: t("finance.kindExpense", "Expense"),
      in: 0,
      out: e.amount,
      pending: false,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <PageContainer
      title={t("finance.incomeExpense", "Income & Expense")}
      // Pinned, at the owner's ask (2026-09-01): this page is four cards and
      // two long tables, and the button that adds a row to it was at the top
      // of a scroll nobody was at the top of.
      stickyHeader
      actions={[
        {
          key: "add",
          label: t("finance.addAdjustment", "Add adjustment"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAddAdjustment(true),
        },
      ]}
    >
      <Flex vertical gap={16}>
        <Flex gap={16} wrap align="stretch">
          {/*
           * 1 — the balance (owner ask 2026-08-27): what the business holds,
           * counted from an opening figure plus everything recorded since.
           * Before anything at all is recorded, the card IS the way to enter
           * that opening figure. Pending marketplace money is not in here —
           * it is not in the bank, which is what a balance claims to be.
           */}
          <Card style={{ flex: "1 1 300px", minWidth: 260 }}>
            {noDataYet ? (
              <Flex vertical gap={12} align="flex-start">
                <Typography.Text strong>
                  {t("finance.balance", "Balance")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t(
                    "finance.noMoneyRecorded",
                    "Nothing is recorded yet. Start the ledger from what the business holds today.",
                  )}
                </Typography.Text>
                <Button
                  type="primary"
                  icon={<WalletOutlined />}
                  onClick={() => setBalanceOpen(true)}
                >
                  {t("finance.addCurrentBalance", "Add the current balance")}
                </Button>
              </Flex>
            ) : (
              <Flex vertical gap={4}>
                <Statistic
                  title={t("finance.balance", "Balance")}
                  value={fmtRp(balance)}
                  styles={{
                    content: {
                      color: balance >= 0 ? "#059669" : "#cf1322",
                    },
                  }}
                />
                {/*
                 * The two pots (owner ask 2026-09-09).
                 *
                 * Under the total rather than instead of it: the sum is what
                 * somebody asks of a business and the split is what they act
                 * on, and a card that showed only the halves would make the
                 * commonest question an addition. Side by side and evenly
                 * divided, because neither is the footnote of the other.
                 */}
                <Flex gap={SPACE.md} style={{ marginBlock: 4 }}>
                  {(
                    [
                      ["cash", t("finance.cash", "Cash"), balances.cash],
                      ["bank", t("finance.bank", "Bank"), balances.bank],
                    ] as const
                  ).map(([key, label, value]) => (
                    <Flex key={key} vertical gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {label}
                      </Typography.Text>
                      <Typography.Text
                        strong
                        type={value < 0 ? "danger" : undefined}
                      >
                        {fmtRp(value)}
                      </Typography.Text>
                    </Flex>
                  ))}
                </Flex>
                {balances.unassigned !== 0 && (
                  // A method nobody has mapped to a pot. Said out loud rather
                  // than folded into either, because a figure that quietly
                  // joins the wrong balance is worse than one that asks a
                  // question.
                  <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
                    {t(
                      "finance.unassignedMoney",
                      "{{amount}} moved through a method that belongs to neither pot.",
                      { amount: fmtRp(balances.unassigned) },
                    )}
                  </Typography.Text>
                )}
                {hasOpening ? (
                  <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                    {t(
                      "finance.includesOpening",
                      "Includes the {{amount}} starting balance recorded {{date}}.",
                      {
                        amount: fmtRp(opened),
                        date: fmtDate(db.settings.openingBalanceAt ?? ""),
                      },
                    )}
                  </Typography.Text>
                ) : (
                  // Reachable even once sales exist: the shop held money
                  // before this app did, and a balance that pretends
                  // otherwise is just a subtotal wearing the wrong name.
                  <Button
                    size="small"
                    type="link"
                    style={{ paddingInline: 0, alignSelf: "flex-start" }}
                    onClick={() => setBalanceOpen(true)}
                  >
                    {t(
                      "finance.setStartingBalance",
                      "Add what the business held before this app",
                    )}
                  </Button>
                )}
                {pendingTotal > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(
                      "finance.pendingNotCounted",
                      "{{amount}} of marketplace money is still pending and not counted.",
                      { amount: fmtRp(pendingTotal) },
                    )}
                  </Typography.Text>
                )}
              </Flex>
            )}
          </Card>

          {/*
           * 2 — the same ledger over a window: today, the last N days, or two
           * dates off the calendar (owner ask 2026-08-27).
           */}
          <Card style={{ flex: "2 1 460px", minWidth: 300 }}>
            <Flex vertical gap={12}>
              <Flex gap={12} wrap align="center" justify="space-between">
                <Typography.Text strong>
                  {t("finance.balanceForPeriod", "Balance for a period")}
                </Typography.Text>
                <Flex gap={8} wrap align="center">
                  <Segmented
                    value={periodDays}
                    onChange={(v) => setPeriodDays(v as number)}
                    options={[
                      { value: 0, label: t("finance.today", "Today") },
                      ...RANGES.map((r) => ({ ...r, label: t(r.label) })),
                      { value: -1, label: t("finance.customRange", "Custom") },
                    ]}
                  />
                  {periodDays === -1 && (
                    <DatePicker.RangePicker
                      value={customRange}
                      onChange={(v) => setCustomRange(v)}
                      aria-label={t("finance.customRange", "Custom")}
                    />
                  )}
                </Flex>
              </Flex>
              {period === null ? (
                <Typography.Text type="secondary">
                  {t(
                    "finance.pickARange",
                    "Pick the two dates on the calendar.",
                  )}
                </Typography.Text>
              ) : (
                <Flex gap={32} wrap>
                  <Statistic
                    title={t("finance.income", "Income")}
                    value={fmtRp(periodIncome)}
                  />
                  <Statistic
                    title={t("finance.expenses", "Expenses")}
                    value={fmtRp(periodExpense)}
                  />
                  <Statistic
                    title={t("finance.net", "Net")}
                    value={fmtRp(periodIncome - periodExpense)}
                    styles={{
                      content: {
                        color:
                          periodIncome - periodExpense >= 0
                            ? "#059669"
                            : "#cf1322",
                      },
                    }}
                  />
                </Flex>
              )}
            </Flex>
          </Card>
        </Flex>

        {/*
         * 3 — pending marketplace money: ONE card, with a picker for which
         * marketplace (owner ask 2026-09-01).
         *
         * It was a card per channel from 2026-08-27, and the reasoning behind
         * that still holds — withdrawing is a per-channel errand, you go to
         * that marketplace's dashboard and press withdraw there. What it got
         * wrong was the shape: two marketplaces meant two identical tables
         * stacked down the page, each with its own search box and its own
         * pagination, and the page's whole middle was one question asked
         * twice. A picker keeps the per-channel worklist and costs one row of
         * chrome instead of a whole card.
         *
         * The chips are built from the channels actually holding money, so a
         * marketplace the shop stops selling on stops appearing rather than
         * sitting at Rp 0 forever. The card renders nothing at all when
         * nothing is pending.
         */}
        {pendingByChannel.length > 0 && (
          <Card
            title={t("finance.pendingTitle", "Pending — awaiting withdrawal")}
            extra={
              <Typography.Text type="secondary">
                {t(
                  "finance.pendingChannelCount",
                  "{{count}} sale(s) · {{total}} awaiting withdrawal",
                  {
                    count: shownPending.length,
                    total: fmtRp(
                      shownPending.reduce((acc, o) => acc + o.total, 0),
                    ),
                  },
                )}
              </Typography.Text>
            }
          >
            <Flex vertical gap={12}>
              {/*
               * A Select, not chips: the owner asked for a dropdown, and the
               * list is genuinely open-ended — every channel that ever holds
               * money gets an entry, and TikTok is already a third.
               *
               * Each option carries its own total, because choosing which
               * marketplace to go and empty is a decision made ON those
               * numbers. A picker that made you select a channel to find out
               * what was in it would be a worse version of the stack of cards
               * this replaces.
               */}
              <Select
                value={activeChannel}
                onChange={setChannelFilter}
                style={{ maxWidth: 360 }}
                aria-label={t("finance.whichMarketplace", "Which marketplace")}
                options={[
                  {
                    value: "ALL",
                    label: t(
                      "finance.allChannelsPending",
                      "All channels · {{total}}",
                      { total: fmtRp(pendingTotal) },
                    ),
                  },
                  ...pendingByChannel.map(([channel, { total, count }]) => ({
                    value: channel,
                    label: t(
                      "finance.channelPendingOption",
                      "{{channel}} · {{total}} in {{count}} sale(s)",
                      { channel, total: fmtRp(total), count },
                    ),
                  })),
                ]}
              />
              <ProTable
                rowKey="id"
                dataSource={shownPending}
                searchPlaceholder={t(
                  "finance.searchOrderCode",
                  "Search order code",
                )}
                columns={[
                  {
                    title: t("finance.order", "Order"),
                    dataIndex: "code",
                    searchable: true,
                  },
                  {
                    // Kept as a column even with the picker above: on "All
                    // channels" it is the only thing telling two rows apart,
                    // and on a single channel it costs one narrow column.
                    title: t("finance.channel", "Channel"),
                    dataIndex: "source",
                    width: 140,
                    facet: true,
                    sortValue: (o) => o.source,
                    render: (v: string) => <Tag>{v}</Tag>,
                  },
                  {
                    title: t("finance.when", "When"),
                    dataIndex: "ts",
                    defaultSortOrder: "descend",
                    render: fmtDateTime,
                  },
                  {
                    title: t("finance.saleAmount", "Sale amount"),
                    key: "total",
                    align: "right",
                    sortValue: (o) => o.total,
                    render: (_, o) => fmtRp(o.total),
                  },
                  {
                    title: "",
                    key: "actions",
                    width: 60,
                    render: (_, o) => (
                      <Tooltip
                        title={t(
                          "finance.confirmTheWithdrawalAndEnter",
                          "Confirm the withdrawal and enter what actually landed",
                        )}
                      >
                        <Button
                          size="small"
                          type="primary"
                          aria-label={`Confirm withdrawal for ${o.code}`}
                          icon={<CheckOutlined />}
                          onClick={() => {
                            setWithdrawing(o);
                            wForm.setFieldsValue({ net: o.total });
                          }}
                        />
                      </Tooltip>
                    ),
                  },
                ]}
              />
            </Flex>
          </Card>
        )}

        <Card
          title={
            <Flex align="center" gap={8}>
              <span>Advertising, and what it brought in</span>
              <Tooltip
                title={t(
                  "finance.attributionIsWhatTheCustomer",
                  "Attribution is what the customer said at the till — the referral source on the sale, or the one on their customer record. It is self-reported, so treat a channel with no spend as word of mouth rather than a free win.",
                )}
              >
                <QuestionCircleOutlined />
              </Tooltip>
            </Flex>
          }
          extra={
            <Typography.Text type="secondary">
              {fmtRp(totalAdSpend)} spent in total
            </Typography.Text>
          }
        >
          {marketing.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                "finance.noMarketingSpendRecordedYet",
                "No marketing spend recorded yet. Add one under Expenses → Marketing & Advertisement.",
              )}
            />
          ) : (
            <ProTable
              rowKey="key"
              dataSource={marketing}
              search={false}
              columns={[
                {
                  title: t("finance.channel", "Channel"),
                  dataIndex: "name",
                  sortValue: (m) => m.name,
                },
                {
                  title: t("finance.spent", "Spent"),
                  key: "spend",
                  align: "right",
                  defaultSortOrder: "descend",
                  sortValue: (m) => m.spend,
                  render: (_, m) => (m.spend ? fmtRp(m.spend) : "—"),
                },
                {
                  title: t("finance.customers", "Customers"),
                  key: "customers",
                  align: "right",
                  sortValue: (m) => m.customers,
                  render: (_, m) => m.customers,
                },
                {
                  title: t("finance.sales", "Sales"),
                  key: "orders",
                  align: "right",
                  sortValue: (m) => m.orders,
                  render: (_, m) => m.orders,
                },
                {
                  title: t("finance.revenue", "Revenue"),
                  key: "revenue",
                  align: "right",
                  sortValue: (m) => m.revenue,
                  render: (_, m) => fmtRp(m.revenue),
                },
                {
                  title: t("finance.costPerCustomer", "Cost per customer"),
                  key: "cpc",
                  align: "right",
                  sortValue: (m) => m.costPerCustomer ?? 0,
                  render: (_, m) =>
                    m.costPerCustomer === null ? "—" : fmtRp(m.costPerCustomer),
                },
                {
                  title: t("finance.returnOnSpend", "Return on spend"),
                  key: "roas",
                  align: "right",
                  sortValue: (m) => m.roas ?? 0,
                  render: (_, m) =>
                    m.roas === null ? (
                      <Tooltip
                        title={t(
                          "finance.nothingWasSpentOnThis",
                          "Nothing was spent on this channel",
                        )}
                      >
                        <Typography.Text type="secondary">
                          {t("finance.noSpend", "no spend")}
                        </Typography.Text>
                      </Tooltip>
                    ) : (
                      <Typography.Text
                        type={m.roas >= 1 ? "success" : "danger"}
                      >
                        {m.roas.toFixed(1)}×
                      </Typography.Text>
                    ),
                },
              ]}
            />
          )}
        </Card>

        {/* The expense side of the ledger. Income above is derived from sales
            and needs no form; money going out is the half somebody types. */}
        <AdjustmentPanel
          addOpen={addAdjustment}
          onCloseAdd={() => setAddAdjustment(false)}
        />

        <Card title={t("finance.recentMovements", "Recent movements")}>
          <ProTable
            rowKey="key"
            dataSource={movements}
            searchPlaceholder={t(
              "finance.searchASaleOrAn",
              "Search a sale or an expense",
            )}
            columns={[
              {
                title: t("finance.when", "When"),
                dataIndex: "at",
                defaultSortOrder: "descend",
                render: (v: string) => fmtDate(v),
              },
              {
                title: t("finance.what", "What"),
                dataIndex: "what",
                searchable: true,
              },
              {
                title: t("finance.kind", "Kind"),
                dataIndex: "kind",
                facet: true,
              },
              {
                title: t("finance.in", "In"),
                key: "in",
                align: "right",
                sortValue: (m) => m.in,
                render: (_, m) =>
                  m.pending ? (
                    <Tag color="orange">pending</Tag>
                  ) : m.in ? (
                    fmtRp(m.in)
                  ) : (
                    "—"
                  ),
              },
              {
                title: t("finance.out", "Out"),
                key: "out",
                align: "right",
                sortValue: (m) => m.out,
                render: (_, m) => (m.out ? fmtRp(m.out) : "—"),
              },
            ]}
          />
        </Card>
      </Flex>

      {/*
       * The one number this page cannot derive: what the business held before
       * the app recorded anything. Entered once; everything after moves it.
       */}
      <Modal
        title={t("finance.startingBalanceTitle", "Record the current balance")}
        open={balanceOpen}
        onCancel={() => setBalanceOpen(false)}
        onOk={saveOpeningBalance}
        okText={t("finance.recordBalanceOk", "Record it")}
      >
        <Typography.Paragraph type="secondary">
          {t(
            "finance.startingBalanceBody",
            "What the business holds right now, before anything this app has recorded. Count the drawer and the bank separately — every income and expense from here on moves one or the other.",
          )}
        </Typography.Paragraph>
        <Form form={balanceForm} layout="vertical">
          {/*
           * Two boxes, and neither is required on its own: a shop that keeps
           * no float leaves the drawer empty, and one that banks nothing
           * leaves the other. What must not happen is a single figure being
           * apportioned by guesswork, which is what one box would force.
           */}
          <Form.Item
            name="cash"
            label={t("finance.openingCash", "In the cash drawer")}
          >
            <MoneyInput />
          </Form.Item>
          <Form.Item
            name="bank"
            label={t("finance.openingBank", "In the bank")}
          >
            <MoneyInput />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Confirm withdrawal — ${withdrawing?.code ?? ""}`}
        open={withdrawing !== null}
        onCancel={() => setWithdrawing(null)}
        onOk={confirmWithdrawal}
        okText={t("finance.confirmWithdrawal", "Confirm withdrawal")}
      >
        <Typography.Paragraph>
          The sale was <strong>{fmtRp(withdrawing?.total ?? 0)}</strong>. Enter
          what actually landed in the bank — {withdrawing?.source.toLowerCase()}{" "}
          keeps a commission, so the two are rarely the same.
        </Typography.Paragraph>
        <Form form={wForm} layout="vertical">
          <Form.Item
            name="net"
            label={t("finance.netAmountReceived", "Net amount received")}
            tooltip={t(
              "finance.thisReplacesTheSaleAmount",
              "This replaces the sale amount everywhere on this page, because it is what the business actually got",
            )}
            rules={[
              { required: true, message: t("form.enterReceived", "Enter what was received") },
              {
                validator: (_, v: number) =>
                  v > (withdrawing?.total ?? 0)
                    ? // Not a hard error: an escrow release can legitimately
                      // include a marketplace subsidy. Warn, don't block.
                      Promise.resolve()
                    : Promise.resolve(),
              },
            ]}
          >
            <MoneyInput />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary">
          The original sale amount is kept on the order, so the commission stays
          visible.
        </Typography.Text>
      </Modal>
    </PageContainer>
  );
}
