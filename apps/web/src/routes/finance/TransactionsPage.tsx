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
import {
  DownloadOutlined,
  PrinterOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import { mutate, nextId, useDb } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { PaymentsModal } from "../../components/PaymentsModal";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  isSettled,
  paymentsOf,
  saleBalance,
  type SalePayment,
} from "../../lib/salePayments.js";
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
/**
 * What a sale's money is doing. Four answers since 2026-09-08 — see
 * `statusOf` for why two were not enough.
 */
type MovementStatus = "Settled" | "Part paid" | "Pending" | "Owed" | "Unpaid";

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
  readonly status: MovementStatus;
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

/**
 * What a sale's money is doing, in one word.
 *
 * Four rather than the two `settled` could express (owner ask 2026-09-08). A
 * marketplace sitting on a payout, a customer who has not paid, and a bill
 * half collected are three different situations, and the shop acts differently
 * on each: press a button on Shopee, telephone a person, or neither.
 *
 * Order matters. "Owed" wins over "Pending" when both are true, because a
 * customer debt is the one with a deadline and a person to ring.
 */
function statusOf(order: Order): MovementStatus {
  const b = saleBalance(order.total, paymentsOf(order));
  if (b.fullySettled) return "Settled";
  if (b.customerOwes > 0) return "Owed";
  if (b.pending > 0) return "Pending";
  return b.settled > 0 ? "Part paid" : "Unpaid";
}

export function TransactionsPage() {
  const { t } = useTranslation();
  const db = useDb();
  /**
   * A `PaymentMethod` code, spelled for a person.
   *
   * `Order.payMethod` holds a code since 2026-09-09, so this column would
   * otherwise read "KARTU_KREDIT". Which marketplace a sale came from is the
   * channel column's job, so this one does not repeat it.
   */
  const methodLabel = (code: string) =>
    db.paymentMethods.find((m) => m.code === code)?.label ?? code;
  const { message } = App.useApp();
  const [reprint, setReprint] = useState<Order | null>(null);
  /** Null when the payment editor is shut; the sale it is about when open. */
  const [editingPay, setEditingPay] = useState<Order | null>(null);

  /**
   * Save a correction, and the log rows that make it safe (owner ask
   * 2026-09-08).
   *
   * One `mutate`: the payments, the `settled` projection over them and every
   * log row go together, exactly as a unit's event and its projection do. A
   * correction half-written — the amount changed and the log row missing — is
   * the one state this feature must never be able to reach, because it is
   * indistinguishable from the amount having always been that.
   */
  const savePayments = (
    order: Order,
    next: SalePayment[],
    reason: string,
  ) => {
    const before = paymentsOf(order);
    const rows = diffPayments(before, next, {
      at: new Date().toISOString(),
      staff: "Michella",
      ...(reason ? { reason } : {}),
    });
    mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      if (!o) return;
      o.payments = next;
      o.settled = isSettled(o.total, next);
      for (const row of rows) {
        d.paymentLog.push({ id: nextId("plog"), ...row });
      }
    });
    setEditingPay(null);
    message.success(
      rows.length === 0
        ? t("transactions.payUnchanged", "Nothing changed.")
        : t("transactions.payLogged", "{{n}} change(s) recorded.", {
            n: rows.length,
          }),
    );
  };

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
        payment: methodLabel(o.payMethod),
        /*
         * Three answers, not two (owner ask 2026-09-08).
         *
         * `settled ? "Settled" : "Pending"` could not tell a marketplace
         * sitting on a payout from a customer who has not paid — and the shop
         * chases a different party for each. A sale that is part collected
         * says so too, because "how much of this have we actually had?" is the
         * question somebody opens this screen to answer.
         */
        status: statusOf(o),
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

  /*
   * Summed over the PAYMENTS, not over the sale totals (owner ask
   * 2026-09-08).
   *
   * A split bill lands in two of these cards at once — half in the shop's
   * hands and half with Shopee — and the old arithmetic, which put a whole
   * sale in exactly one bucket by its `settled` flag, could not put it in two.
   * It counted the split example as Rp10jt pending when Rp5jt of it was in the
   * till.
   */
  const money = useMemo(() => {
    let settled = 0;
    let pending = 0;
    let owed = 0;
    for (const o of db.orders) {
      const b = saleBalance(o.total, paymentsOf(o));
      settled += b.settled;
      pending += b.pending;
      owed += b.customerOwes;
    }
    return { settled, pending, owed };
  }, [db.orders]);
  const totalIn = money.settled;
  const totalOut = movements.reduce((t, m) => t + m.moneyOut, 0);
  const pendingTotal = money.pending;

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
              title={t("transactions.stillPending", "With a marketplace")}
              value={fmtRp(pendingTotal)}
              styles={{ content: { color: "#d48806" } }}
            />
          </Card>
          {/* Kept apart from the card beside it, which is the whole point of
              the 2026-09-08 split: a marketplace holding a payout is not a
              customer failing to pay, and one figure covering both is a figure
              nobody can act on. */}
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.customersOwe", "Customers owe")}
              value={fmtRp(money.owed)}
              styles={{ content: { color: "#cf1322" } }}
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
                  /*
                   * Amber for money somebody else is holding, red for money a
                   * customer owes — the shop acts differently on each.
                   *
                   * Translated in a switch rather than through a lookup, so
                   * `test/i18n.test.ts` can review the words: it finds copy by
                   * reading the source for literal two-argument `t()` calls,
                   * and a table indexed by a variable is invisible to it.
                   */
                  <Tag
                    color={
                      v === "Owed" || v === "Unpaid"
                        ? "red"
                        : v === "Pending" || v === "Part paid"
                          ? "orange"
                          : "default"
                    }
                  >
                    {v === "Settled"
                      ? t("transactions.stSettled", "Settled")
                      : v === "Part paid"
                        ? t("transactions.stPartPaid", "Part paid")
                        : v === "Pending"
                          ? t("transactions.stPending", "With a marketplace")
                          : v === "Owed"
                            ? t("transactions.stOwed", "Owed")
                            : t("transactions.stUnpaid", "Unpaid")}
                  </Tag>
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
                width: 96,
                render: (_, m) =>
                  m.order ? (
                    <Flex gap={4}>
                      <Tooltip
                        title={t(
                          "transactions.editPayments",
                          "What was paid, and correcting it",
                        )}
                      >
                        <Button
                          size="small"
                          aria-label={t(
                            "transactions.editPaymentsAria",
                            "Payments on {{code}}",
                            { code: m.reference },
                          )}
                          icon={<WalletOutlined />}
                          onClick={() => setEditingPay(m.order!)}
                        />
                      </Tooltip>
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
                    </Flex>
                  ) : null,
              },
            ]}
          />
        </Card>
      </Flex>

      <PaymentsModal
        open={editingPay !== null}
        code={editingPay?.code ?? ""}
        total={editingPay?.total ?? 0}
        payments={editingPay ? paymentsOf(editingPay) : []}
        log={
          editingPay
            ? db.paymentLog
                .filter((e) =>
                  paymentsOf(editingPay).some((p) => p.id === e.paymentId),
                )
                .slice()
                .sort((a, b) => b.at.localeCompare(a.at))
            : []
        }
        methods={db.paymentMethods
          .filter((m) => m.forSale && m.active)
          .map((m) => ({ value: m.code, label: m.label }))}
        onClose={() => setEditingPay(null)}
        onSave={(next, reason) =>
          editingPay && savePayments(editingPay, next, reason)
        }
      />

      <InvoiceModal
        db={db}
        {...(reprint ? { order: reprint } : {})}
        open={reprint !== null}
        onClose={() => setReprint(null)}
      />
    </PageContainer>
  );
}
