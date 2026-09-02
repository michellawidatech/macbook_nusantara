/**
 * Transaction History — every movement of money, in one searchable list.
 *
 * Cashflow answers "how are we doing"; this answers "what happened, exactly".
 * They read the same two tables and are deliberately not the same screen: the
 * Cashflow page's "Recent movements" card is a glance, capped and unfiltered,
 * while this one is the ledger you open when a customer rings up about a
 * receipt from three weeks ago.
 *
 * Sales ONLY, since 2026-08-24. Expenses moved to Income & Expense, which is
 * now the one ledger carrying every movement of money — sales and purchases
 * posting into it automatically, manual lines on top.
 *
 * The split is by what the screen is FOR rather than by where the data lives.
 * This is the receipt-finder: a customer rings up about something they bought
 * three weeks ago, and every column here — serial, salesperson, channel,
 * payment — narrows towards one sale. Expenses answered none of those questions
 * and only made the Type facet necessary.
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
import { SPACE, TYPE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";

/**
 * One line of the ledger.
 *
 * Sales and expenses are flattened into a single shape here rather than being
 * rendered by a per-kind branch in every column: a column that has to ask "is
 * this a sale?" five times is a column that will disagree with itself once.
 */
/**
 * One product on one sale, and the machine it was.
 *
 * A sale of three things used to render as every product name joined by
 * commas, a `·`, then every serial joined by commas — which left the reader
 * pairing the first name with the first serial by counting along two lists
 * (owner report 2026-08-26). They are pairs in the data, so they are pairs on
 * screen.
 */
interface MovementLine {
  /** Null when no unit in the system carries this serial — see the mapper. */
  readonly product: string | null;
  readonly serial: string;
}

interface Movement {
  readonly key: string;
  readonly at: string;
  readonly reference: string;
  /**
   * Everything on the sale as one flat string.
   *
   * Still built, and still the ONLY thing search, sort and the CSV read: a
   * spreadsheet cell holds one string, and searching "which sale was this
   * serial on" has to match across every product and serial at once. `lines`
   * is the same content shaped for the screen; neither is derived from the
   * other at render time, so they cannot disagree mid-row.
   */
  readonly detail: string;
  /** The same sale as product/serial pairs. Empty for a row with no units. */
  readonly lines: readonly MovementLine[];
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
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [reprint, setReprint] = useState<Order | null>(null);

  const movements = useMemo<Movement[]>(() => {
    const sales: Movement[] = db.orders.map((o) => {
      const customer = db.customers.find((c) => c.id === o.customerId);
      const lines: MovementLine[] = o.serials.map((serial) => {
        const unit = db.units.find((u) => u.serial === serial);
        const sku = unit && db.skus.find((k) => k.id === unit.skuId);
        // Null rather than the serial repeated: a unit whose product the
        // catalogue no longer knows should show its serial once, not twice.
        return {
          product: sku ? `${sku.name} ${sku.variantLabel}` : null,
          serial,
        };
      });
      const units = lines.map((l) => l.product ?? l.serial).join(", ");
      return {
        key: `o-${o.id}`,
        at: o.ts,
        reference: o.code,
        // Serials go in the searchable detail on purpose: "which sale was this
        // serial on" is the question this shop asks most, and it is the one the
        // unit's own timeline answers slowest.
        detail: `${units} · ${o.serials.join(", ")}`,
        lines,
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

    return [...sales].sort((a, b) => b.at.localeCompare(a.at));
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
    <PageContainer
      title={t("transactions.transactionHistory", "Transaction History")}
    >
      <Flex vertical gap={16}>
        <Flex gap={16} wrap>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.transactions", "Transactions")}
              value={movements.length}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.moneyInSettled", "Money in (settled)")}
              value={fmtRp(totalIn)}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.moneyOut", "Money out")}
              value={fmtRp(totalOut)}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.stillPending", "Still pending")}
              value={fmtRp(pendingTotal)}
              styles={{ content: { color: "#d48806" } }}
            />
          </Card>
        </Flex>

        <Card>
          <ProTable
            rowKey="key"
            dataSource={movements}
            searchPlaceholder={t(
              "transactions.searchACodeSerialProduct",
              "Search a code, serial, product, customer or expense",
            )}
            selectable
            extra={
              <Button
                icon={<DownloadOutlined />}
                onClick={() => exportCsv(movements)}
              >
                {t("transactions.exportAll", "Export all")}
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
                    {t("transactions.exportSelected", "Export selected")}
                  </Button>
                </>
              );
            }}
            columns={[
              {
                title: t("transactions.when", "When"),
                dataIndex: "at",
                width: 150,
                defaultSortOrder: "descend",
                render: (v: string) => fmtDateTime(v),
              },
              {
                title: t("transactions.reference", "Reference"),
                dataIndex: "reference",
                searchable: true,
                width: 170,
              },
              {
                title: t("transactions.detail", "Detail"),
                key: "detail",
                searchable: true,
                sortValue: (m) => m.detail,
                render: (_, m) => (
                  <Flex vertical gap={SPACE.xs}>
                    {/*
                     * One row per product, with the serial beside it. The old
                     * single line joined every name, then every serial, which
                     * meant pairing them by counting along two lists.
                     *
                     * `wrap` on each pair rather than truncation: a serial is
                     * the thing someone is here to read, so on a narrow column
                     * it drops under its product instead of being cut off.
                     */}
                    {m.lines.length > 0 ? (
                      m.lines.map((line) => (
                        <Flex
                          key={line.serial}
                          gap={SPACE.sm}
                          align="baseline"
                          wrap
                        >
                          {line.product !== null && (
                            <Typography.Text>{line.product}</Typography.Text>
                          )}
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontFamily: "monospace",
                              fontSize: TYPE.sm,
                            }}
                          >
                            {line.serial}
                          </Typography.Text>
                        </Flex>
                      ))
                    ) : (
                      <Typography.Text>{m.detail}</Typography.Text>
                    )}
                    {/* The customer, separated from the lines above by its own
                        gap so it does not read as a fourth product. */}
                    <Typography.Text
                      type="secondary"
                      style={{ marginTop: SPACE.xs }}
                    >
                      {m.counterparty}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("transactions.salesperson", "Salesperson"),
                dataIndex: "salesperson",
                facet: true,
                searchable: true,
                width: 140,
              },
              {
                title: t("transactions.channel", "Channel"),
                dataIndex: "channel",
                facet: true,
                width: 120,
              },
              {
                title: t("transactions.payment", "Payment"),
                dataIndex: "payment",
                facet: true,
                width: 130,
              },
              {
                title: t("transactions.status", "Status"),
                dataIndex: "status",
                facet: true,
                width: 110,
                render: (v: string) => (
                  <Tag color={v === "Pending" ? "orange" : "default"}>{v}</Tag>
                ),
              },
              {
                title: t("transactions.in", "In"),
                key: "in",
                align: "right",
                width: 140,
                sortValue: (m) => m.moneyIn,
                render: (_, m) => (m.moneyIn ? fmtRp(m.moneyIn) : "—"),
              },
              {
                title: t("transactions.out", "Out"),
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
                    <Tooltip
                      title={t(
                        "transactions.printThisInvoiceAgain",
                        "Print this invoice again",
                      )}
                    >
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
