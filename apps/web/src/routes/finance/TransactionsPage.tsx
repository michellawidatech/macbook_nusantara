/**
 * Transaction History — every movement of money, in one searchable list.
 *
 * Cashflow answers "how are we doing"; this answers "what happened, exactly".
 * They read the same two tables and are deliberately not the same screen: the
 * Cashflow page's "Recent movements" card is a glance, capped and unfiltered,
 * while this one is the ledger you open when a customer rings up about a
 * receipt from three weeks ago.
 *
 * Sales and expenses share one list rather than sitting in two tabs, because
 * the questions people actually bring here — "what happened on the 12th",
 * "what did Ayu sell in August", "find the Rp2.400.000 one" — cut across both.
 * The Type facet separates them for anyone who wants them separate.
 *
 * Selection exists for a reason beyond ticking boxes: the selected rows get
 * totalled, and can be exported. Reconciling a bank statement against a shop's
 * books is a subset-summing exercise, and doing it with a calculator beside the
 * screen is how the numbers end up wrong.
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DownloadOutlined, PrinterOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import { useDb } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { EXPENSE_CATEGORIES } from "../../mock/seed.js";

/**
 * One line of the ledger.
 *
 * Sales and expenses are flattened into a single shape here rather than being
 * rendered by a per-kind branch in every column: a column that has to ask "is
 * this a sale?" five times is a column that will disagree with itself once.
 */
interface Movement {
  readonly key: string;
  readonly kind: "Sale" | "Expense";
  readonly at: string;
  readonly reference: string;
  readonly detail: string;
  readonly counterparty: string;
  readonly salesperson: string;
  readonly channel: string;
  readonly payment: string;
  readonly status: "Settled" | "Pending" | "Paid";
  readonly moneyIn: number;
  readonly moneyOut: number;
  /** Present on a sale, so the row can reprint its invoice. */
  readonly order?: Order;
}

/** RFC 4180 enough for a spreadsheet: quote everything, double the quotes. */
function toCsv(rows: readonly Movement[]): string {
  const header = [
    "When",
    "Kind",
    "Reference",
    "Detail",
    "Counterparty",
    "Salesperson",
    "Channel",
    "Payment",
    "Status",
    "Money in",
    "Money out",
  ];
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.at,
      r.kind,
      r.reference,
      r.detail,
      r.counterparty,
      r.salesperson,
      r.channel,
      r.payment,
      r.status,
      r.moneyIn,
      r.moneyOut,
    ]
      .map(cell)
      .join(","),
  );
  return [header.map(cell).join(","), ...lines].join("\r\n");
}

export function TransactionsPage() {
  const db = useDb();
  const { message } = App.useApp();
  const [reprint, setReprint] = useState<Order | null>(null);

  const movements = useMemo<Movement[]>(() => {
    const expenseLabel = (kind: string) =>
      EXPENSE_CATEGORIES.find((c) => c.value === kind)?.label ?? kind;

    const sales: Movement[] = db.orders.map((o) => {
      const customer = db.customers.find((c) => c.id === o.customerId);
      const units = o.serials
        .map((serial) => {
          const unit = db.units.find((u) => u.serial === serial);
          const sku = unit && db.skus.find((k) => k.id === unit.skuId);
          return sku ? `${sku.name} ${sku.variantLabel}` : serial;
        })
        .join(", ");
      return {
        key: `o-${o.id}`,
        kind: "Sale",
        at: o.ts,
        reference: o.code,
        // Serials go in the searchable detail on purpose: "which sale was this
        // serial on" is the question this shop asks most, and it is the one the
        // unit's own timeline answers slowest.
        detail: `${units} · ${o.serials.join(", ")}`,
        counterparty: customer?.name ?? "Walk-in",
        salesperson:
          db.salesmen.find((s) => s.id === o.salesmanId)?.name ?? "—",
        channel: o.source,
        payment: o.payMethod,
        status: o.settled ? "Settled" : "Pending",
        moneyIn: o.total,
        moneyOut: 0,
        order: o,
      };
    });

    const expenses: Movement[] = db.expenses.map((e) => ({
      key: `e-${e.id}`,
      kind: "Expense",
      // Expenses carry a date, not a timestamp. Noon keeps them in the middle
      // of their own day when the list sorts by time, rather than at midnight
      // where they would sort ahead of everything that actually happened first.
      at: `${e.date}T12:00:00.000Z`,
      reference: e.id.toUpperCase(),
      detail: e.label,
      counterparty: expenseLabel(e.kind),
      salesperson: "—",
      channel:
        db.referralSources.find((r) => r.id === e.referralSourceId)?.name ??
        "—",
      payment: "—",
      status: "Paid",
      moneyIn: 0,
      moneyOut: e.amount,
    }));

    return [...sales, ...expenses].sort((a, b) => b.at.localeCompare(a.at));
  }, [
    db.orders,
    db.expenses,
    db.customers,
    db.units,
    db.skus,
    db.salesmen,
    db.referralSources,
  ]);

  const totalIn = movements
    .filter((m) => m.status !== "Pending")
    .reduce((t, m) => t + m.moneyIn, 0);
  const totalOut = movements.reduce((t, m) => t + m.moneyOut, 0);
  const pendingTotal = movements
    .filter((m) => m.status === "Pending")
    .reduce((t, m) => t + m.moneyIn, 0);

  const exportCsv = (rows: readonly Movement[]) => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // Revoked immediately: the click has already handed the blob to the
    // browser's download machinery, and an un-revoked object URL keeps the
    // whole file alive in memory for the life of the tab.
    URL.revokeObjectURL(url);
    message.success(`${rows.length} row(s) exported.`);
  };

  return (
    <PageContainer title="Transaction History">
      <Flex vertical gap={16}>
        <Flex gap={16} wrap>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic title="Transactions" value={movements.length} />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic title="Money in (settled)" value={fmtRp(totalIn)} />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic title="Money out" value={fmtRp(totalOut)} />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title="Still pending"
              value={fmtRp(pendingTotal)}
              styles={{ content: { color: "#d48806" } }}
            />
          </Card>
        </Flex>

        <Card>
          <ProTable
            rowKey="key"
            dataSource={movements}
            searchPlaceholder="Search a code, serial, product, customer or expense"
            selectable
            extra={
              <Button
                icon={<DownloadOutlined />}
                onClick={() => exportCsv(movements)}
              >
                Export all
              </Button>
            }
            bulkActions={(selected, clear) => {
              const inSum = selected.reduce((t, m) => t + m.moneyIn, 0);
              const outSum = selected.reduce((t, m) => t + m.moneyOut, 0);
              return (
                <>
                  <Typography.Text type="secondary">
                    In {fmtRp(inSum)} · Out {fmtRp(outSum)} · Net{" "}
                    {fmtRp(inSum - outSum)}
                  </Typography.Text>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      exportCsv(selected);
                      clear();
                    }}
                  >
                    Export selected
                  </Button>
                </>
              );
            }}
            columns={[
              {
                title: "When",
                dataIndex: "at",
                width: 150,
                defaultSortOrder: "descend",
                render: (v: string) => fmtDateTime(v),
              },
              {
                title: "Kind",
                dataIndex: "kind",
                facet: true,
                width: 100,
                render: (v: string) => (
                  <Tag color={v === "Sale" ? "green" : "volcano"}>{v}</Tag>
                ),
              },
              {
                title: "Reference",
                dataIndex: "reference",
                searchable: true,
                width: 170,
              },
              {
                title: "Detail",
                key: "detail",
                searchable: true,
                sortValue: (m) => m.detail,
                render: (_, m) => (
                  <>
                    <div>{m.detail}</div>
                    <Typography.Text type="secondary">
                      {m.counterparty}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: "Salesperson",
                dataIndex: "salesperson",
                facet: true,
                searchable: true,
                width: 140,
              },
              {
                title: "Channel",
                dataIndex: "channel",
                facet: true,
                width: 120,
              },
              {
                title: "Payment",
                dataIndex: "payment",
                facet: true,
                width: 130,
              },
              {
                title: "Status",
                dataIndex: "status",
                facet: true,
                width: 110,
                render: (v: string) => (
                  <Tag color={v === "Pending" ? "orange" : "default"}>{v}</Tag>
                ),
              },
              {
                title: "In",
                key: "in",
                align: "right",
                width: 140,
                sortValue: (m) => m.moneyIn,
                render: (_, m) => (m.moneyIn ? fmtRp(m.moneyIn) : "—"),
              },
              {
                title: "Out",
                key: "out",
                align: "right",
                width: 140,
                sortValue: (m) => m.moneyOut,
                render: (_, m) => (m.moneyOut ? fmtRp(m.moneyOut) : "—"),
              },
              {
                title: "",
                key: "actions",
                width: 56,
                render: (_, m) =>
                  m.order ? (
                    <Tooltip title="Print this invoice again">
                      <Button
                        size="small"
                        aria-label={`Print invoice ${m.reference}`}
                        icon={<PrinterOutlined />}
                        onClick={() => setReprint(m.order!)}
                      />
                    </Tooltip>
                  ) : null,
              },
            ]}
          />
        </Card>
      </Flex>

      <InvoiceModal
        db={db}
        {...(reprint ? { order: reprint } : {})}
        open={reprint !== null}
        onClose={() => setReprint(null)}
      />
    </PageContainer>
  );
}
