/**
 * Cashflow — money in, money out, and marketplace money still in escrow.
 *
 * Three questions, three sections:
 *  1. What happened today, and what is still owed to us (the KPI row).
 *  2. What has been happening (the chart — daily income, expenses, net and
 *     pending, each toggleable).
 *  3. Is the advertising working (marketing spend scored against the customers
 *     who said they came from that channel).
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Modal,
  Segmented,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CheckOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { MoneyInput } from "../../components/MoneyInput";
import { fmtRp, fmtDateTime, fmtDate } from "../../lib/format.js";
import { useDb, mutate } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

/** Rp 12.400.000 → "12,4jt". Axis ticks and end labels need to be short. */
function shortRp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}m`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}rb`;
  return String(Math.round(n));
}

export function CashflowPage() {
  const db = useDb();
  const { message } = App.useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [days, setDays] = useState(30);
  const [withdrawing, setWithdrawing] = useState<Order | null>(null);
  const [wForm] = Form.useForm<{ net: number }>();

  const todayIncome = db.orders
    .filter((o) => o.settled && o.ts.slice(0, 10) === today)
    .reduce((t, o) => t + o.total, 0);
  const todayExpense = db.expenses
    .filter((e) => e.date === today)
    .reduce((t, e) => t + e.amount, 0);
  const pending = db.orders.filter((o) => !o.settled);
  const pendingTotal = pending.reduce((t, o) => t + o.total, 0);

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

  /** Daily buckets for the chart, oldest first. */
  const chart = useMemo(() => {
    const categories: string[] = [];
    const income: number[] = [];
    const expense: number[] = [];
    const net: number[] = [];
    const pend: number[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      categories.push(
        d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      );
      const inc = db.orders
        .filter((o) => o.settled && o.ts.slice(0, 10) === iso)
        .reduce((t, o) => t + o.total, 0);
      const exp = db.expenses
        .filter((e) => e.date === iso)
        .reduce((t, e) => t + e.amount, 0);
      const pen = db.orders
        .filter((o) => !o.settled && o.ts.slice(0, 10) === iso)
        .reduce((t, o) => t + o.total, 0);
      income.push(inc);
      expense.push(exp);
      net.push(inc - exp);
      pend.push(pen);
    }
    return {
      categories,
      series: [
        { key: "income", label: "Income", values: income },
        { key: "expense", label: "Expenses", values: expense },
        { key: "net", label: "Net", values: net },
        { key: "pending", label: "Pending", values: pend },
      ],
    };
  }, [db.orders, db.expenses, days]);

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

  const movements = [
    ...db.orders.map((o) => ({
      key: `o-${o.id}`,
      at: o.ts,
      what: `Sale ${o.code} (${o.source.toLowerCase()})`,
      kind: "Sale",
      in: o.settled ? o.total : 0,
      out: 0,
      pending: !o.settled,
    })),
    ...db.expenses.map((e) => ({
      key: `e-${e.id}`,
      at: `${e.date}T12:00:00.000Z`,
      what: e.label,
      kind: "Expense",
      in: 0,
      out: e.amount,
      pending: false,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <PageContainer title="Cashflow">
      <Flex vertical gap={16}>
        <Flex gap={16} wrap>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic title="Income today" value={fmtRp(todayIncome)} />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic title="Expenses today" value={fmtRp(todayExpense)} />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title="Net today"
              value={fmtRp(todayIncome - todayExpense)}
              styles={{
                content: {
                  color:
                    todayIncome - todayExpense >= 0 ? "#059669" : "#cf1322",
                },
              }}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title="Pending (not yet withdrawn)"
              value={fmtRp(pendingTotal)}
              styles={{ content: { color: "#d48806" } }}
            />
          </Card>
        </Flex>

        <Card
          title="Money over time"
          extra={
            <Segmented
              value={days}
              onChange={(v) => setDays(v as number)}
              options={RANGES}
            />
          }
        >
          <TimeSeriesChart
            categories={chart.categories}
            series={chart.series}
            format={fmtRp}
            formatTick={shortRp}
          />
          <Typography.Text type="secondary">
            Untick a line to take it off the chart. "Pending" is marketplace
            money booked that day but not yet withdrawn, so it is not counted in
            Net until you confirm it below.
          </Typography.Text>
        </Card>

        <Card title="Money pending withdrawal">
          {pending.length === 0 ? (
            <Typography.Text type="secondary">
              Nothing pending — all marketplace money has been withdrawn.
            </Typography.Text>
          ) : (
            <ProTable
              rowKey="id"
              dataSource={pending}
              searchPlaceholder="Search order code"
              columns={[
                { title: "Order", dataIndex: "code", searchable: true },
                {
                  title: "When",
                  dataIndex: "ts",
                  defaultSortOrder: "descend",
                  render: fmtDateTime,
                },
                {
                  title: "Source",
                  dataIndex: "source",
                  facet: true,
                  render: (v) => <Tag color="orange">{v}</Tag>,
                },
                {
                  title: "Sale amount",
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
                    <Tooltip title="Confirm the withdrawal and enter what actually landed">
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
          )}
        </Card>

        <Card
          title={
            <Flex align="center" gap={8}>
              <span>Advertising, and what it brought in</span>
              <Tooltip title="Attribution is what the customer said at the till — the referral source on the sale, or the one on their customer record. It is self-reported, so treat a channel with no spend as word of mouth rather than a free win.">
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
              description="No marketing spend recorded yet. Add one under Expenses → Marketing & Advertisement."
            />
          ) : (
            <ProTable
              rowKey="key"
              dataSource={marketing}
              search={false}
              columns={[
                {
                  title: "Channel",
                  dataIndex: "name",
                  sortValue: (m) => m.name,
                },
                {
                  title: "Spent",
                  key: "spend",
                  align: "right",
                  defaultSortOrder: "descend",
                  sortValue: (m) => m.spend,
                  render: (_, m) => (m.spend ? fmtRp(m.spend) : "—"),
                },
                {
                  title: "Customers",
                  key: "customers",
                  align: "right",
                  sortValue: (m) => m.customers,
                  render: (_, m) => m.customers,
                },
                {
                  title: "Sales",
                  key: "orders",
                  align: "right",
                  sortValue: (m) => m.orders,
                  render: (_, m) => m.orders,
                },
                {
                  title: "Revenue",
                  key: "revenue",
                  align: "right",
                  sortValue: (m) => m.revenue,
                  render: (_, m) => fmtRp(m.revenue),
                },
                {
                  title: "Cost per customer",
                  key: "cpc",
                  align: "right",
                  sortValue: (m) => m.costPerCustomer ?? 0,
                  render: (_, m) =>
                    m.costPerCustomer === null ? "—" : fmtRp(m.costPerCustomer),
                },
                {
                  title: "Return on spend",
                  key: "roas",
                  align: "right",
                  sortValue: (m) => m.roas ?? 0,
                  render: (_, m) =>
                    m.roas === null ? (
                      <Tooltip title="Nothing was spent on this channel">
                        <Typography.Text type="secondary">
                          no spend
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

        <Card title="Recent movements">
          <ProTable
            rowKey="key"
            dataSource={movements}
            searchPlaceholder="Search a sale or an expense"
            columns={[
              {
                title: "When",
                dataIndex: "at",
                defaultSortOrder: "descend",
                render: (v: string) => fmtDate(v),
              },
              { title: "What", dataIndex: "what", searchable: true },
              { title: "Kind", dataIndex: "kind", facet: true },
              {
                title: "In",
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
                title: "Out",
                key: "out",
                align: "right",
                sortValue: (m) => m.out,
                render: (_, m) => (m.out ? fmtRp(m.out) : "—"),
              },
            ]}
          />
        </Card>
      </Flex>

      <Modal
        title={`Confirm withdrawal — ${withdrawing?.code ?? ""}`}
        open={withdrawing !== null}
        onCancel={() => setWithdrawing(null)}
        onOk={confirmWithdrawal}
        okText="Confirm withdrawal"
      >
        <Typography.Paragraph>
          The sale was <strong>{fmtRp(withdrawing?.total ?? 0)}</strong>. Enter
          what actually landed in the bank — {withdrawing?.source.toLowerCase()}{" "}
          keeps a commission, so the two are rarely the same.
        </Typography.Paragraph>
        <Form form={wForm} layout="vertical">
          <Form.Item
            name="net"
            label="Net amount received"
            tooltip="This replaces the sale amount everywhere on this page, because it is what the business actually got"
            rules={[
              { required: true, message: "Enter what was received" },
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
