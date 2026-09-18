/**
 * Money the shop is owed, by whoever is holding it.
 *
 * > *"It can be creating a new tab for pending balance/piutang which source is
 * > from tokopedia/shopee/shopee paylater, can mark as done … Then it is
 * > editable and logged."*
 * > — owner, 2026-09-08
 *
 * ## Two tables, because there are two debtors
 *
 * The page is split down the middle and that split is the point of it. A
 * **marketplace** holding a payout and a **customer** who has not paid are
 * both "money we do not have yet", and every other similarity ends there:
 *
 * | | who has it | how it is collected | how it goes wrong |
 * |---|---|---|---|
 * | marketplace | Shopee, Tokopedia | press a button on their dashboard | fees nobody itemised |
 * | customer | a person | telephone them | a promise nobody chased |
 *
 * Before this, `Order.settled` covered both with one boolean, so a Shopee sale
 * awaiting withdrawal was indistinguishable from a customer four weeks late.
 * Nobody could answer either question.
 *
 * ## Grouped by channel, because withdrawing is a per-channel errand
 *
 * Somebody signs in to Shopee, presses a button, then does the same on
 * Tokopedia. A single "Rp23.400.000 pending" figure is not something anybody
 * can act on — which is the same reasoning the Income & Expense card was
 * reshaped under on 2026-09-01, taken one step further now that a withdrawal
 * is a document rather than a tick.
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CheckCircleOutlined, EditOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageContainer } from "../../components/PageContainer";
import { SettleModal } from "../../components/SettleModal";
import { fmtRp, fmtDate, fmtDateTime } from "../../lib/format.js";
import { channelOf } from "../../lib/channels.js";
import {
  commissionPctOf,
  settlementTotals,
  type SettlementFee,
} from "../../lib/marketplace.js";
import {
  isOverdue,
  paymentsOf,
  saleBalance,
  type SalePayment,
} from "../../lib/salePayments.js";
import {
  appendEvent,
  mutate,
  nextId,
  useDb,
  currentStaffName,
} from "../../mock/store.js";
import type { MockDb, Order } from "../../mock/seed.js";
import { SPACE, TYPE } from "../../theme/tokens";

/** One pending part, with the sale it came off. */
interface PendingRow {
  readonly key: string;
  readonly order: Order;
  readonly payment: SalePayment;
  readonly channel: string;
  readonly customer: string;
}

/** One channel's pending money, and the sales behind it. */
interface ChannelRow {
  readonly key: string;
  readonly channel: string;
  readonly gross: number;
  readonly count: number;
  readonly rows: readonly PendingRow[];
}

/** One customer debt: a sale, or what they owed before this app. */
interface OwedRow {
  readonly key: string;
  /** Absent for a debt from before this app (`Customer.openingBalance`). */
  readonly order?: Order;
  readonly customer: string;
  readonly owed: number;
  readonly dueAt?: string;
  readonly overdue: boolean;
}

export function ReceivablesPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [settling, setSettling] = useState<ChannelRow | null>(null);
  /** A recorded withdrawal being corrected. *"Then it is editable and logged."* */
  const [amending, setAmending] = useState<
    (typeof db.settlements)[number] | null
  >(null);

  const customerName = (o: Order) =>
    db.customers.find((c) => c.id === o.customerId)?.name ??
    t("piutang.walkIn", "Walk-in");

  /** Everything a marketplace is holding, grouped by which one. */
  const channels = useMemo<ChannelRow[]>(() => {
    const by = new Map<string, PendingRow[]>();
    for (const o of db.orders) {
      for (const p of paymentsOf(o)) {
        if (p.state !== "PENDING") continue;
        const channel = p.channel ?? o.source;
        const row: PendingRow = {
          key: `${o.id}-${p.id}`,
          order: o,
          payment: p,
          channel,
          customer: customerName(o),
        };
        by.set(channel, [...(by.get(channel) ?? []), row]);
      }
    }
    return [...by.entries()]
      .map(([channel, rows]) => ({
        key: channel,
        channel,
        rows,
        count: rows.length,
        gross: rows.reduce((n, r) => n + r.payment.amount, 0),
      }))
      .sort((a, b) => b.gross - a.gross);
  }, [db.orders, db.customers]);

  /** Everything a customer owes, per sale. */
  const owed = useMemo<OwedRow[]>(() => {
    const out: OwedRow[] = [];
    for (const o of db.orders) {
      const b = saleBalance(o.total, paymentsOf(o));
      if (b.customerOwes <= 0) continue;
      const overdue = paymentsOf(o).some((p) => isOverdue(p));
      out.push({
        key: o.id,
        order: o,
        customer: customerName(o),
        owed: b.customerOwes,
        ...(b.nextDueAt === undefined ? {} : { dueAt: b.nextDueAt }),
        overdue,
      });
    }
    // What a customer owed before this app — B2Soft's balance that no invoice
    // explains (owner answer 2026-09-13: receivables "need to combine all").
    // No sale and no promise date: a name to ring and a figure.
    for (const c of db.customers) {
      if (!c.openingBalance || c.openingBalance <= 0) continue;
      out.push({
        key: `opening-${c.id}`,
        customer: c.name,
        owed: c.openingBalance,
        overdue: false,
      });
    }
    // Overdue first, then by the nearest promise: this is a call list.
    return out.sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
    );
  }, [db.orders, db.customers]);

  const pendingTotal = channels.reduce((n, c) => n + c.gross, 0);
  const owedTotal = owed.reduce((n, r) => n + r.owed, 0);

  /**
   * Record a withdrawal: the money lands, and the fees are kept.
   *
   * One `mutate` for the whole channel, because that is what the errand is —
   * one press on Shopee's dashboard pays out every sale at once — and because
   * the payments, their `settled` projections and the settlement document have
   * to move together. A payout half-recorded would leave sales showing as
   * pending against money that is already in the bank.
   *
   * The RECEIVED figure is apportioned back across the sales in proportion to
   * what each contributed, with the rounding remainder given to the largest.
   * That is not cosmetic: `Order.netReceived` is what the finance screens add
   * up, and a payout of Rp8.850.000 spread as three round numbers that sum to
   * Rp8.849.999 would leave a rupiah unaccounted for on every reconciliation
   * from now on.
   */
  const settle = (
    row: ChannelRow,
    result: {
      fees: SettlementFee[];
      received: number;
      reason?: string;
    },
  ) => {
    const totals = settlementTotals({
      gross: row.gross,
      fees: result.fees,
      received: result.received,
    });
    const shares = apportion(
      result.received,
      row.rows.map((r) => r.payment.amount),
    );
    const at = new Date().toISOString();
    mutate((d: MockDb) => {
      const settlementId = nextId("stl");
      row.rows.forEach((r, i) => {
        const o = d.orders.find((x) => x.id === r.order.id);
        if (!o) return;
        const parts = (o.payments ?? paymentsOf(r.order)).map((p) =>
          p.id === r.payment.id ? { ...p, state: "SETTLED" as const, at } : p,
        );
        o.payments = parts;
        o.settled = parts.every((p) => p.state === "SETTLED");
        // What the sale was worth before the platform's cut, and what came
        // back. `grossTotal` is only written when the two differ, so a payout
        // with no fees leaves the sale exactly as it was.
        const net = shares[i] ?? 0;
        if (net !== r.payment.amount) {
          o.grossTotal = o.total;
          o.netReceived = net;
        }
        // The sale's own timeline should say the money arrived — it is the
        // one place somebody chasing a serial will look.
        for (const serial of o.serials) {
          appendEvent(d, serial, {
            type: "DICATAT",
            refCode: o.code,
            note: `Withdrawal from ${channelOf(row.channel)?.label ?? row.channel}: ${fmtRp(net)}`,
          });
        }
      });
      d.settlements.push({
        id: settlementId,
        paymentId: row.rows.map((r) => r.payment.id).join(","),
        orderId: row.rows.map((r) => r.order.id).join(","),
        channel: row.channel,
        gross: row.gross,
        fees: result.fees,
        received: result.received,
        ...(result.reason ? { reason: result.reason } : {}),
        at,
        staff: currentStaffName(),
      });
      d.settlementLog.push({
        id: nextId("slog"),
        settlementId,
        at,
        staff: currentStaffName(),
        action: "RECORDED",
        after: { received: result.received, deducted: totals.deducted },
        ...(result.reason ? { reason: result.reason } : {}),
      });
    });
    setSettling(null);
    message.success(
      t("piutang.settled", "{{amount}} recorded from {{channel}}.", {
        amount: fmtRp(result.received),
        channel: channelOf(row.channel)?.label ?? row.channel,
      }),
    );
  };

  /**
   * Correct a withdrawal that was recorded wrongly.
   *
   * The money has already landed and the sales are already settled — what is
   * being corrected is the SHOP'S ACCOUNT of it: which fee was which, and how
   * much actually arrived. So this rewrites the settlement and appends an
   * AMENDED log row carrying both figures, and does not touch the payments.
   *
   * A reason is required whenever the corrected figures still disagree with
   * the arithmetic, for the same reason it was required the first time: the
   * disagreement is the interesting part and a bare number cannot be
   * reconstructed later.
   */
  const amend = (
    existing: (typeof db.settlements)[number],
    result: { fees: SettlementFee[]; received: number; reason?: string },
  ) => {
    const before = settlementTotals({
      gross: existing.gross,
      fees: existing.fees,
      received: existing.received,
    });
    const after = settlementTotals({
      gross: existing.gross,
      fees: result.fees,
      received: result.received,
    });
    const at = new Date().toISOString();
    mutate((d) => {
      const i = d.settlements.findIndex((x) => x.id === existing.id);
      if (i >= 0) {
        d.settlements[i] = {
          ...d.settlements[i]!,
          fees: result.fees,
          received: result.received,
          ...(result.reason
            ? { reason: result.reason }
            : { reason: undefined }),
        };
      }
      d.settlementLog.push({
        id: nextId("slog"),
        settlementId: existing.id,
        at,
        staff: currentStaffName(),
        action: "AMENDED",
        before: { received: before.received, deducted: before.deducted },
        after: { received: after.received, deducted: after.deducted },
        ...(result.reason ? { reason: result.reason } : {}),
      });
    });
    setAmending(null);
    message.success(t("piutang.amended", "Withdrawal corrected."));
  };

  return (
    <PageContainer title={t("piutang.title", "Pending balance & receivables")}>
      <Flex vertical gap={SPACE.md}>
        <Flex gap={SPACE.md} wrap>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title={t("piutang.withMarketplaces", "With marketplaces")}
              value={fmtRp(pendingTotal)}
              styles={{ content: { color: "#d48806" } }}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "piutang.withMarketplacesHint",
                "Paid by the customer. Withdraw it from each platform.",
              )}
            </Typography.Text>
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title={t("piutang.customersOwe", "Customers owe")}
              value={fmtRp(owedTotal)}
              styles={{ content: { color: "#cf1322" } }}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "piutang.customersOweHint",
                "Not paid at all. Somebody has to ring them.",
              )}
            </Typography.Text>
          </Card>
        </Flex>

        <Card title={t("piutang.marketplaceMoney", "Waiting at a marketplace")}>
          <Table<ChannelRow>
            size="small"
            rowKey="key"
            dataSource={channels}
            pagination={false}
            locale={{
              emptyText: t(
                "piutang.noPending",
                "Every marketplace has paid out.",
              ),
            }}
            expandable={{
              expandedRowRender: (c) => (
                <Table<PendingRow>
                  size="small"
                  rowKey="key"
                  dataSource={c.rows as PendingRow[]}
                  pagination={false}
                  columns={[
                    {
                      title: t("piutang.sale", "Sale"),
                      key: "code",
                      render: (_, r) => (
                        <Link to="/finance/transactions">{r.order.code}</Link>
                      ),
                    },
                    {
                      title: t("piutang.customer", "Customer"),
                      dataIndex: "customer",
                    },
                    {
                      title: t("piutang.when", "Sold"),
                      key: "at",
                      width: 130,
                      render: (_, r) => fmtDate(r.order.ts),
                    },
                    {
                      title: t("piutang.amount", "Amount"),
                      key: "amount",
                      width: 150,
                      align: "right",
                      render: (_, r) => fmtRp(r.payment.amount),
                    },
                  ]}
                />
              ),
            }}
            columns={[
              {
                title: t("piutang.channel", "Channel"),
                key: "channel",
                render: (_, c) => (
                  <Typography.Text strong>
                    {channelOf(c.channel)?.label ?? c.channel}
                  </Typography.Text>
                ),
              },
              {
                title: t("piutang.sales", "Sales"),
                key: "count",
                width: 100,
                align: "right",
                render: (_, c) => c.count,
              },
              {
                title: t("piutang.gross", "Gross"),
                key: "gross",
                width: 170,
                align: "right",
                render: (_, c) => fmtRp(c.gross),
              },
              {
                /*
                 * What the rule expects, said before anybody presses anything.
                 *
                 * A prediction, and labelled as one: the received figure in
                 * the dialog is the truth, because it is the only one that can
                 * be checked against a bank statement.
                 */
                title: t("piutang.expected", "Should land"),
                key: "expected",
                width: 190,
                align: "right",
                render: (_, c) => {
                  const pct = commissionPctOf(
                    c.channel,
                    db.settings.marketplaceFees,
                  );
                  const totals = settlementTotals({
                    gross: c.gross,
                    fees: [
                      {
                        id: "preview",
                        kind: "COMMISSION",
                        amount: Math.floor((c.gross * pct) / 100),
                      },
                    ],
                  });
                  return (
                    <Flex vertical align="flex-end" gap={0}>
                      <Typography.Text>
                        {fmtRp(totals.expected)}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("piutang.afterPct", "after {{pct}}%", { pct })}
                      </Typography.Text>
                    </Flex>
                  );
                },
              },
              {
                title: "",
                key: "actions",
                width: 190,
                render: (_, c) => (
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckCircleOutlined />}
                    onClick={() => setSettling(c)}
                  >
                    {t("piutang.markDone", "Mark as received")}
                  </Button>
                ),
              },
            ]}
          />
        </Card>

        <Card title={t("piutang.customerDebts", "Owed by customers")}>
          <Table<OwedRow>
            size="small"
            rowKey="key"
            dataSource={owed}
            pagination={false}
            locale={{
              emptyText: t("piutang.noDebts", "Nobody owes the shop anything."),
            }}
            columns={[
              {
                title: t("piutang.customer", "Customer"),
                dataIndex: "customer",
                render: (v: string, r) => (
                  <Flex vertical gap={0}>
                    <Typography.Text strong>{v}</Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {r.order?.code ??
                        t("piutang.fromBefore", "From before this app")}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("piutang.billed", "Bill"),
                key: "total",
                width: 160,
                align: "right",
                render: (_, r) => (r.order ? fmtRp(r.order.total) : "—"),
              },
              {
                title: t("piutang.owed", "Still owed"),
                key: "owed",
                width: 160,
                align: "right",
                render: (_, r) => (
                  <Typography.Text type="danger" strong>
                    {fmtRp(r.owed)}
                  </Typography.Text>
                ),
              },
              {
                title: t("piutang.due", "Promised"),
                key: "due",
                width: 190,
                render: (_, r) =>
                  r.dueAt ? (
                    <Tag color={r.overdue ? "red" : "default"}>
                      {r.overdue
                        ? t("piutang.overdueOn", "Overdue — {{date}}", {
                            date: fmtDate(r.dueAt),
                          })
                        : fmtDate(r.dueAt)}
                    </Tag>
                  ) : (
                    <Typography.Text type="secondary">
                      {t("piutang.noDate", "No date agreed")}
                    </Typography.Text>
                  ),
              },
              {
                title: "",
                key: "actions",
                width: 56,
                render: (_, r) =>
                  r.order === undefined ? (
                    <Tooltip
                      title={t(
                        "piutang.editOldDebt",
                        "Correct it on the customer",
                      )}
                    >
                      <Link to="/customers">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={t(
                            "piutang.editOldDebtAria",
                            "Open {{name}} in Customers",
                            { name: r.customer },
                          )}
                        />
                      </Link>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      title={t(
                        "piutang.openInHistory",
                        "Correct what was paid",
                      )}
                    >
                      <Link to="/finance/transactions">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={t(
                            "piutang.openInHistoryAria",
                            "Open {{code}} in Transaction History",
                            { code: r.order.code },
                          )}
                        />
                      </Link>
                    </Tooltip>
                  ),
              },
            ]}
          />
        </Card>

        {db.settlements.length > 0 && (
          <Card title={t("piutang.withdrawals", "Withdrawals recorded")}>
            <Table
              size="small"
              rowKey="id"
              dataSource={db.settlements.slice().reverse()}
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: t("piutang.when", "When"),
                  key: "at",
                  width: 190,
                  render: (_: unknown, s: (typeof db.settlements)[number]) =>
                    fmtDateTime(s.at),
                },
                {
                  title: t("piutang.channel", "Channel"),
                  key: "channel",
                  width: 140,
                  render: (_: unknown, s: (typeof db.settlements)[number]) =>
                    channelOf(s.channel)?.label ?? s.channel,
                },
                {
                  title: t("piutang.gross", "Gross"),
                  key: "gross",
                  width: 160,
                  align: "right",
                  render: (_: unknown, s: (typeof db.settlements)[number]) =>
                    fmtRp(s.gross),
                },
                {
                  title: t("piutang.deducted", "Fees"),
                  key: "fees",
                  align: "right",
                  render: (_: unknown, s: (typeof db.settlements)[number]) => {
                    const totals = settlementTotals({
                      gross: s.gross,
                      fees: s.fees,
                      received: s.received,
                    });
                    return (
                      <Flex vertical align="flex-end" gap={0}>
                        <Typography.Text>
                          {fmtRp(totals.deducted)}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: TYPE.sm }}
                        >
                          {s.fees
                            .map(
                              (f) => `${f.label ?? f.kind} ${fmtRp(f.amount)}`,
                            )
                            .join(" · ")}
                        </Typography.Text>
                      </Flex>
                    );
                  },
                },
                {
                  title: t("piutang.landed", "Landed"),
                  key: "received",
                  width: 170,
                  align: "right",
                  render: (_: unknown, s: (typeof db.settlements)[number]) => (
                    <Flex vertical align="flex-end" gap={0}>
                      <Typography.Text strong>
                        {fmtRp(s.received)}
                      </Typography.Text>
                      {s.reason && (
                        <Typography.Text
                          type="warning"
                          style={{ fontSize: TYPE.sm }}
                        >
                          {s.reason}
                        </Typography.Text>
                      )}
                    </Flex>
                  ),
                },
                {
                  title: "",
                  key: "amend",
                  width: 56,
                  render: (_: unknown, s: (typeof db.settlements)[number]) => (
                    <Tooltip
                      title={t("piutang.amend", "Correct this withdrawal")}
                    >
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        aria-label={t(
                          "piutang.amendAria",
                          "Correct the withdrawal from {{channel}}",
                          {
                            channel: channelOf(s.channel)?.label ?? s.channel,
                          },
                        )}
                        onClick={() => setAmending(s)}
                      />
                    </Tooltip>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </Flex>

      <SettleModal
        open={amending !== null}
        channel={amending?.channel ?? ""}
        gross={amending?.gross ?? 0}
        count={1}
        rates={db.settings.marketplaceFees}
        {...(amending
          ? {
              existing: {
                fees: amending.fees,
                received: amending.received,
                ...(amending.reason ? { reason: amending.reason } : {}),
              },
            }
          : {})}
        onClose={() => setAmending(null)}
        onSave={(result) => amending && amend(amending, result)}
      />

      <SettleModal
        open={settling !== null}
        channel={settling?.channel ?? ""}
        gross={settling?.gross ?? 0}
        count={settling?.count ?? 0}
        rates={db.settings.marketplaceFees}
        onClose={() => setSettling(null)}
        onSave={(result) => settling && settle(settling, result)}
      />
    </PageContainer>
  );
}

/**
 * Split one payout across the sales it covers, losing nothing.
 *
 * Largest-remainder: each sale gets its proportional share floored, and the
 * rupiah left over go to the sales with the biggest fractions. Any other
 * rounding leaves a few rupiah unaccounted for on every reconciliation
 * afterwards, which is the kind of error that costs an afternoon each time
 * somebody notices it.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((n) => Math.floor(n));
  let left = total - out.reduce((n, x) => n + x, 0);
  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}
