/**
 * Transaction History — every sale, in one searchable list.
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
 * ## The columns, as the owner laid them out (2026-09-19)
 *
 * Order number / reference · Unit · Payment status · Received · the actions.
 * Each answers one question about a receipt:
 *
 * - **Order** — the SI code, and under it the marketplace's own order number
 *   when a payment carries one (`SalePayment.ref`), because that is what a
 *   Shopee or Tokopedia income report names a payout by. The date and the
 *   channel ride on a small line beneath, and the channel is its LABEL — the
 *   column used to print the raw `SHOPEE`.
 * - **Unit** — product and serial as pairs, one line each, with the customer
 *   under them as the old Detail column had it.
 * - ~~**Status**~~ — the Returned / Partly returned column left on
 *   2026-09-20 (owner ask). The fact did not: a unit that came back still
 *   carries its own tag on its line in the Unit column, which is the reading
 *   somebody actually needs — WHICH unit, not how many — and `saleReturnStatus`
 *   still writes the whole-sale word into the CSV export.
 * - **Payment status** — Settled, With a marketplace, Partly paid, Owed: which
 *   party still has money outstanding. The old status checked "is anything
 *   owed?" first, so a half-collected bill read exactly like an unpaid one.
 * - **Received** — the SETTLED money, the only money that is the shop's, with
 *   the bill under it.
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
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDate, fmtDateTime, fmtNone } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { EditTransactionModal } from "./EditTransactionModal";
import {
  ShopeeSettlementImport,
  pendingShopeePayments,
} from "./ShopeeSettlementImport.js";
import { recordPayouts } from "../../lib/payouts.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  billAfterReturns,
  isSettled,
  orderBalance,
  paymentsOf,
  refundedOf,
  type SaleBalance,
} from "../../lib/salePayments.js";
import {
  paymentRefOf,
  returnedDebts,
  returnedSerials,
  salePaymentStatus,
  saleReturnStatus,
  type SalePaymentStatus,
  type SaleReturnStatus,
} from "../../lib/saleStatus.js";
import { labelOf, ORDER_SOURCE } from "../../i18n/enumLabels.js";
import { deleteSale, saleDeletionBlock } from "../../lib/saleDeletion.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { draftKey } from "../../hooks/usePersistentState";

/**
 * One product on one sale, and the unit it was.
 *
 * A sale of three things used to render as every product name joined by
 * commas, a `·`, then every serial joined by commas — which left the reader
 * pairing the first name with the first serial by counting along two lists
 * (owner report 2026-08-26). They are pairs in the data, so they are pairs on
 * screen.
 */
interface SaleLine {
  /** Null when no unit in the system carries this serial — see the mapper. */
  readonly product: string | null;
  readonly serial: string;
  /** Brought back by the customer since this sale — `lib/saleStatus.ts`. */
  readonly returned: boolean;
}

/** One sale, flattened once so no column has to look anything up. */
interface SaleRow {
  readonly key: string;
  readonly order: Order;
  readonly at: string;
  readonly code: string;
  /** The marketplace's order number, when a payment carries one. */
  readonly ref?: string;
  /** The channel's label, translated — never the raw `Order.source` code. */
  readonly channel: string;
  readonly customer: string;
  /**
   * Searched, never drawn — so a sale naming nobody has none, rather than a
   * placeholder word that a search for "none" would then match.
   */
  readonly salesperson: string | undefined;
  readonly lines: readonly SaleLine[];
  /**
   * Every product and serial on the sale as one flat string.
   *
   * What search and sort read: "which sale was this serial on" has to match
   * across every product and serial at once. `lines` is the same content
   * shaped for the screen; both are built here in one pass, so they cannot
   * disagree mid-row.
   */
  readonly detail: string;
  readonly status: SaleReturnStatus;
  readonly payStatus: SalePaymentStatus;
  readonly balance: SaleBalance;
  /**
   * What a marketplace kept of this sale's payouts, by channel — an expense
   * on Income & Expense, shown here under Received so the gap between "of
   * total" and the bank is explained on the row (owner 2026-10-30).
   */
  readonly kept: readonly {
    readonly channel: string;
    readonly amount: number;
  }[];
}

/**
 * Open Income & Expense searched for one sale's number, with the list's own
 * filters cleared so nothing hides the row. Written to the keys `ProTable`
 * keeps that list's state under (`persistKey="cashflow.unified"`), which it
 * reads when the page mounts.
 */
function showExpensesOf(code: string): void {
  const key = (part: string) => draftKey(`list.cashflow.unified.${part}`);
  try {
    localStorage.setItem(key("search"), JSON.stringify(code));
    localStorage.removeItem(key("filters"));
    localStorage.removeItem(key("ranges"));
  } catch {
    // Storage refused (Safari private mode): the page opens unsearched.
  }
}

/**
 * Amber for money a marketplace is holding, red for money a customer owes —
 * the shop acts differently on each: press a button on Shopee, or telephone a
 * person. Partly paid is the customer's too, a shade short of Owed. A debt a
 * return cancelled is the purple a returned unit's tag already wears on this
 * screen: nobody has anything left to chase, and it is not money that came in.
 */
const PAY_COLOR: Record<SalePaymentStatus, string> = {
  SETTLED: "default",
  WITH_MARKETPLACE: "gold",
  PARTLY_PAID: "volcano",
  OWED: "red",
  PARTLY_PAID_RETURNED: "purple",
  UNPAID_RETURNED: "purple",
};

/** RFC 4180 enough for a spreadsheet: quote everything, double the quotes. */
function toCsv(
  header: readonly string[],
  body: readonly (readonly (string | number)[])[],
): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [header, ...body].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function TransactionsPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message, modal } = App.useApp();
  const [reprint, setReprint] = useState<Order | null>(null);
  /** Null when the editor is shut; the sale it is about when open. */
  const [editing, setEditing] = useState<Order | null>(null);
  /**
   * The Shopee seller-balance upload (2026-09-21), here since Pending Payment
   * was folded into this page (owner ask 2026-10-22: *"it should just be
   * transaction history + upload the shopee balance"*). A sale still waiting
   * on its payout is the "With a marketplace" payment status of this list.
   */
  const [importing, setImporting] = useState(false);

  /** Why a sale cannot be deleted, in words; undefined when it can. */
  const deleteBlockText = (order: Order) => {
    switch (saleDeletionBlock(db, order)) {
      case "RETURNED":
        return t(
          "transactions.deleteReturned",
          "Something on this sale was returned. Delete the return first.",
        );
      case "TRADE_IN":
        return t(
          "transactions.deleteTradeIn",
          "This sale took a trade-in, which is in stock now.",
        );
      case "UNIT_MOVED":
        return t(
          "transactions.deleteMoved",
          "A unit on this sale has moved on since (reserved, moved or sold again).",
        );
      case "LINKED_MONEY":
        return t(
          "transactions.deleteLinked",
          "An Income & Expense line names this sale.",
        );
      case "DP":
        return t(
          "transactions.deleteDp",
          "A reservation's DP paid part of this sale.",
        );
      default:
        return undefined;
    }
  };

  /*
   * Delete a sale (owner ask 2026-10-22; asked, "gone completely"). The units
   * go back on the shelf as they were before it, its money stops counting,
   * and it leaves every list. `lib/saleDeletion.ts` is the rule.
   */
  const removeSale = (order: Order) =>
    modal.confirm({
      title: t("transactions.deleteTitle", "Delete {{code}}?", {
        code: order.code,
      }),
      content: t(
        "transactions.deleteBody",
        "The sale and its payments are removed for good, and its {{count}} unit(s) go back on the shelf as they were before it. This cannot be undone.",
        { count: order.serials.length + (order.lines?.length ?? 0) },
      ),
      okText: t("transactions.deleteOk", "Delete transaction"),
      okButtonProps: { danger: true },
      onOk: () => {
        let done = false;
        const staff = currentStaffName();
        mutate((d) => {
          done = deleteSale(d, order.id, {
            staff,
            now: new Date().toISOString(),
            nextMoveId: () => nextId("sm"),
          });
        });
        if (done)
          message.success(
            t("transactions.deleted", "{{code}} deleted.", {
              code: order.code,
            }),
          );
      },
    });

  /*
   * The words for each status, in a switch rather than a lookup table so
   * `test/i18n.test.ts` can review them: it finds copy by reading the source
   * for literal two-argument `t()` calls, and a table indexed by a variable is
   * invisible to it.
   */
  const statusLabel = (s: SaleReturnStatus) =>
    s === "RETURNED"
      ? t("transactions.stReturned", "Returned")
      : s === "PARTLY_RETURNED"
        ? t("transactions.stPartlyReturned", "Partly returned")
        : t("transactions.stCompleted", "Completed");
  const payLabel = (s: SalePaymentStatus) =>
    s === "SETTLED"
      ? t("transactions.stSettled", "Settled")
      : s === "WITH_MARKETPLACE"
        ? t("transactions.stPending", "With a marketplace")
        : s === "PARTLY_PAID"
          ? t("transactions.stPartPaid", "Partly paid")
          : s === "UNPAID_RETURNED"
            ? t("transactions.stUnpaidReturned", "Unpaid, returned")
            : s === "PARTLY_PAID_RETURNED"
              ? t("transactions.stPartPaidReturned", "Partly paid, returned")
              : t("transactions.stOwed", "Owed");

  /**
   * Turn what a marketplace was holding into money the shop has.
   *
   * One `mutate` over every sale ticked: the payments, the `settled`
   * projection over them and the log rows go together, the rule every writer
   * in this app follows.
   */
  const settlePending = (orders: readonly Order[]) => {
    const stamp = new Date().toISOString();
    let moved = 0;
    mutate((d) => {
      for (const order of orders) {
        const o = d.orders.find((x) => x.id === order.id);
        if (!o) continue;
        const before = paymentsOf(o);
        if (!before.some((p) => p.state === "PENDING")) continue;
        const next = before.map((p) =>
          p.state === "PENDING"
            ? { ...p, state: "SETTLED" as const, at: stamp }
            : p,
        );
        o.payments = next;
        o.settled = isSettled(billAfterReturns(o), next, refundedOf(o));
        for (const row of diffPayments(before, next, {
          at: stamp,
          staff: currentStaffName(),
        })) {
          d.paymentLog.push({ id: nextId("plog"), ...row });
        }
        moved += 1;
      }
    });
    message.success(
      t("transactions.settledCount", "{{count}} sale(s) marked as settled.", {
        count: moved,
      }),
    );
  };

  const sales = useMemo<SaleRow[]>(() => {
    const back = returnedSerials(db.orders, db.events);
    // What a return cancelled of each sale's debt — "Unpaid, returned".
    const debts = returnedDebts(db.orders, db.events, db.stockMoves);
    const settlementsOf = new Map<string, (typeof db.settlements)[number][]>();
    for (const st of db.settlements)
      settlementsOf.set(st.orderId, [
        ...(settlementsOf.get(st.orderId) ?? []),
        st,
      ]);
    // Maps rather than a `find` per sale: the B2Soft history is thousands of
    // receipts against thousands of customers.
    const units = new Map(db.units.map((u) => [u.serial, u]));
    const skus = new Map(db.skus.map((k) => [k.id, k]));
    const customers = new Map(db.customers.map((c) => [c.id, c]));
    const salesmen = new Map(db.salesmen.map((s) => [s.id, s]));
    return db.orders
      .map((o) => {
        const customer =
          o.customerId === null ? undefined : customers.get(o.customerId);
        const returned = back.get(o.id);
        const lines: SaleLine[] = [
          ...o.serials.map((serial) => {
            const unit = units.get(serial);
            const sku = unit && skus.get(unit.skuId);
            // Null rather than the serial repeated: a unit whose product the
            // catalogue no longer knows should show its serial once, not twice.
            return {
              product: sku ? `${sku.name} ${sku.variantLabel}` : null,
              serial,
              returned: returned?.has(serial) ?? false,
            };
          }),
          // A counted product (2026-09-19): no serial, so the second line
          // says how many instead.
          ...(o.lines ?? []).map((l) => {
            const sku = skus.get(l.skuId);
            return {
              product: sku ? `${sku.name} ${sku.variantLabel}` : l.skuId,
              serial: `×${l.qty}`,
              returned: (l.returnedQty ?? 0) >= l.qty,
            };
          }),
        ];
        const payments = paymentsOf(o);
        const balance = orderBalance(o);
        const keptBy = new Map<string, number>();
        for (const st of settlementsOf.get(o.id) ?? [])
          keptBy.set(
            st.channel,
            (keptBy.get(st.channel) ?? 0) + st.gross - st.received,
          );
        const ref = paymentRefOf(payments);
        return {
          key: o.id,
          order: o,
          at: o.ts,
          code: o.code,
          ...(ref === undefined ? {} : { ref }),
          channel: labelOf(ORDER_SOURCE, o.source, t),
          customer: customer
            ? customerLabel(customer)
            : t("piutang.walkIn", "Walk-in"),
          salesperson:
            o.salesmanId === undefined
              ? undefined
              : salesmen.get(o.salesmanId)?.name,
          lines,
          // Serials go in the searchable detail on purpose: "which sale was
          // this serial on" is the question this shop asks most, and it is
          // the one the unit's own timeline answers slowest.
          detail: lines
            .map((l) => (l.product ? `${l.product} (${l.serial})` : l.serial))
            .join("; "),
          status: saleReturnStatus(o.serials, returned, o.lines),
          payStatus: salePaymentStatus(balance, debts.get(o.id)),
          balance,
          kept: [...keptBy]
            .filter(([, amount]) => amount !== 0)
            .map(([channel, amount]) => ({ channel, amount })),
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [
    db.orders,
    db.events,
    db.stockMoves,
    db.customers,
    db.units,
    db.skus,
    db.salesmen,
    db.settlements,
    t,
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
    for (const s of sales) {
      settled += s.balance.settled;
      pending += s.balance.pending;
      owed += s.balance.customerOwes;
    }
    return { settled, pending, owed };
  }, [sales]);

  const exportCsv = (rows: readonly SaleRow[]) => {
    const returnedWord = t("transactions.stReturned", "Returned");
    const csv = toCsv(
      [
        t("transactions.orderNumber", "Order number"),
        t("transactions.paymentRef", "Payment reference"),
        t("transactions.date", "Date"),
        t("transactions.channel", "Channel"),
        t("transactions.customer", "Customer"),
        t("transactions.units", "Units"),
        t("transactions.status", "Status"),
        t("transactions.paymentStatus", "Payment status"),
        t("transactions.received", "Received"),
        t("transactions.total", "Total"),
      ],
      rows.map((r) => [
        r.code,
        r.ref ?? "",
        // The shop's own clock, sortable as text — an ISO instant in UTC
        // would put an evening sale on the next day's row.
        dayjs(r.at).format("YYYY-MM-DD HH:mm"),
        r.channel,
        r.customer,
        r.lines
          .map((l) =>
            [l.product, l.serial, l.returned ? `(${returnedWord})` : null]
              .filter(Boolean)
              .join(" "),
          )
          .join("; "),
        statusLabel(r.status),
        payLabel(r.payStatus),
        r.balance.settled,
        r.balance.total,
      ]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // Revoked immediately: the click has already handed the blob to the
    // browser's download, and an un-revoked object URL keeps the whole file
    // alive in memory for the life of the tab.
    URL.revokeObjectURL(url);
    message.success(
      t("transactions.exported", "{{count}} row(s) exported.", {
        count: rows.length,
      }),
    );
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
              value={sales.length}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.moneyInSettled", "Money in (settled)")}
              value={fmtRp(money.settled)}
            />
          </Card>
          {/* "Money out" is gone (2026-09-19): this screen has held sales
              only since 2026-08-24, so it read Rp 0 on every visit, and the
              In/Out columns it summed left with the new layout. */}
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("transactions.stillPending", "With a marketplace")}
              value={fmtRp(money.pending)}
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
          <ProTable<SaleRow>
            persistKey="transactions"
            rowKey="key"
            dataSource={sales}
            searchPlaceholder={t(
              "transactions.searchOrders",
              "Search an order, reference, serial, product or customer",
            )}
            selectable
            extra={
              <Flex gap={SPACE.sm} wrap>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => setImporting(true)}
                >
                  {t("piutang.uploadShopee", "Upload a Shopee report")}
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => exportCsv(sales)}
                >
                  {t("transactions.exportAll", "Export all")}
                </Button>
              </Flex>
            }
            bulkActions={(selected, clear) => {
              const received = selected.reduce(
                (n, r) => n + r.balance.settled,
                0,
              );
              const billed = selected.reduce((n, r) => n + r.balance.total, 0);
              return (
                <>
                  <Typography.Text type="secondary">
                    {t(
                      "transactions.selectedSum",
                      "Received {{received}} of {{total}}",
                      { received: fmtRp(received), total: fmtRp(billed) },
                    )}
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
                  {/* Money a marketplace was holding that has landed (owner
                      ask 2026-09-23). It records the payout arriving and
                      nothing else — a withdrawal whose fees somebody wants
                      itemised is `Receive` on Pending Payment, which keeps a
                      settlement document. */}
                  {selected.some((r) => r.balance.pending > 0) && (
                    <Button
                      size="small"
                      icon={<CheckCircleOutlined />}
                      onClick={() => {
                        settlePending(selected.map((r) => r.order));
                        clear();
                      }}
                    >
                      {t("transactions.markSettled", "Mark as settled")}
                    </Button>
                  )}
                </>
              );
            }}
            columns={[
              {
                title: t("transactions.orderNumber", "Order number"),
                key: "order",
                width: COLUMN.code,
                // Newest first, by when it was sold — which is also the order
                // the SI codes run in.
                defaultSortOrder: "descend",
                sortValue: (r) => Date.parse(r.at),
                searchable: true,
                searchValue: (r) => `${r.code} ${r.salesperson ?? ""}`,
                render: (_, r) => (
                  <Typography.Text strong>{r.code}</Typography.Text>
                ),
              },
              {
                title: t("transactions.referenceId", "Reference ID"),
                key: "ref",
                width: COLUMN.code,
                searchable: true,
                searchValue: (r) => r.ref ?? "",
                sortValue: (r) => r.ref ?? "",
                render: (_, r) => (
                  <Typography.Text
                    type={r.ref === undefined ? "secondary" : undefined}
                    style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
                  >
                    {r.ref ?? fmtNone()}
                  </Typography.Text>
                ),
              },
              {
                title: t("transactions.date", "Date"),
                key: "at",
                width: COLUMN.date,
                dateRange: true,
                facetLabel: t("transactions.date", "Date"),
                sortValue: (r) => Date.parse(r.at),
                render: (_, r) => fmtDateTime(r.at),
              },
              {
                title: t("transactions.channel", "Channel"),
                key: "channel",
                width: COLUMN.tag,
                facet: true,
                facetLabel: t("transactions.channel", "Channel"),
                facetValue: (r) => r.channel,
                sortValue: (r) => r.channel,
                render: (_, r) => r.channel,
              },
              {
                title: t("transactions.customer", "Customer"),
                key: "customer",
                searchable: true,
                searchValue: (r) => r.customer,
                sortValue: (r) => r.customer,
                render: (_, r) => r.customer,
              },
              {
                title: t("transactions.unit", "Unit"),
                key: "unit",
                searchable: true,
                sortValue: (r) => r.detail,
                searchValue: (r) => r.detail,
                render: (_, r) =>
                  r.lines.length === 0 ? (
                    <Typography.Text type="secondary">
                      {fmtNone()}
                    </Typography.Text>
                  ) : (
                    <Flex vertical gap={SPACE.xs}>
                      {r.lines.map((line, i) => (
                        <Flex
                          key={`${i}-${line.serial}`}
                          gap={SPACE.sm}
                          align="baseline"
                          wrap
                        >
                          <Typography.Text>
                            {line.product ?? fmtNone()}
                          </Typography.Text>
                          {line.returned && (
                            <Tag color="purple">
                              {t("transactions.stReturned", "Returned")}
                            </Tag>
                          )}
                        </Flex>
                      ))}
                    </Flex>
                  ),
              },
              {
                title: t("transactions.serialNumber", "Serial number"),
                key: "serial",
                width: COLUMN.serial,
                searchable: true,
                searchValue: (r) => r.lines.map((l) => l.serial).join(" "),
                render: (_, r) =>
                  r.lines.length === 0 ? (
                    <Typography.Text type="secondary">
                      {fmtNone()}
                    </Typography.Text>
                  ) : (
                    <Flex vertical gap={SPACE.xs}>
                      {r.lines.map((line, i) => (
                        <Typography.Text
                          key={`${i}-${line.serial}`}
                          type="secondary"
                          style={{
                            fontFamily: "monospace",
                            fontSize: TYPE.sm,
                          }}
                        >
                          {line.serial}
                        </Typography.Text>
                      ))}
                    </Flex>
                  ),
              },
              {
                title: t("transactions.paymentStatus", "Payment status"),
                key: "payStatus",
                width: COLUMN.status,
                facet: true,
                facetLabel: t("transactions.paymentStatus", "Payment status"),
                facetValue: (r) => payLabel(r.payStatus),
                sortValue: (r) => payLabel(r.payStatus),
                render: (_, r) => {
                  // The promise date, where the customer owes and made one.
                  const due =
                    r.payStatus === "OWED" || r.payStatus === "PARTLY_PAID"
                      ? r.balance.nextDueAt
                      : undefined;
                  const late =
                    due !== undefined && Date.parse(due) < Date.now();
                  return (
                    <Flex vertical gap={SPACE.xs} align="flex-start">
                      <Tag color={PAY_COLOR[r.payStatus]}>
                        {payLabel(r.payStatus)}
                      </Tag>
                      {due !== undefined && (
                        <Typography.Text
                          type={late ? "danger" : "secondary"}
                          style={{ fontSize: TYPE.sm }}
                        >
                          {late
                            ? t(
                                "transactions.overdueSince",
                                "Overdue since {{date}}",
                                { date: fmtDate(due) },
                              )
                            : t("transactions.dueOn", "Due {{date}}", {
                                date: fmtDate(due),
                              })}
                        </Typography.Text>
                      )}
                    </Flex>
                  );
                },
              },
              {
                title: t("transactions.received", "Received"),
                key: "received",
                align: "right",
                width: COLUMN.money,
                sortValue: (r) => r.balance.settled,
                render: (_, r) => (
                  <Flex vertical align="flex-end" gap={0}>
                    <Typography.Text strong>
                      {fmtRp(r.balance.settled)}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {t("transactions.ofTotal", "of {{total}}", {
                        total: fmtRp(r.balance.total),
                      })}
                    </Typography.Text>
                    {r.kept.map((k) => (
                      // The deduction is an expense on Income & Expense, under
                      // this sale's number; the link opens that list already
                      // searched for it (owner 2026-10-30).
                      <Link
                        key={k.channel}
                        to="/finance/cashflow"
                        onClick={() => showExpensesOf(r.code)}
                        style={{ fontSize: TYPE.sm, textAlign: "right" }}
                      >
                        {t(
                          "transactions.keptAsExpense",
                          "{{amount}} kept by {{channel}} · recorded as an expense",
                          {
                            amount: fmtRp(k.amount),
                            channel: k.channel,
                          },
                        )}
                      </Link>
                    ))}
                  </Flex>
                ),
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                title: "",
                key: "actions",
                // Three icon buttons since 2026-10-22 (Delete joined them).
                width: COLUMN.actions + 32,
                render: (_, r) => (
                  <Flex gap={4}>
                    <Tooltip
                      title={t("transactions.seeReceipt", "Download invoice")}
                    >
                      <Button
                        size="small"
                        aria-label={t(
                          "transactions.seeReceiptAria",
                          "Receipt for {{code}}",
                          { code: r.code },
                        )}
                        icon={<FileTextOutlined />}
                        onClick={() => setReprint(r.order)}
                      />
                    </Tooltip>
                    <Tooltip
                      title={t("transactions.editSale", "Edit transaction")}
                    >
                      <span>
                        <Button
                          size="small"
                          aria-label={t(
                            "transactions.editSaleAria",
                            "Edit {{code}}",
                            { code: r.code },
                          )}
                          icon={<EditOutlined />}
                          onClick={() => setEditing(r.order)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        deleteBlockText(r.order) ??
                        t("transactions.deleteSale", "Delete transaction")
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          danger
                          disabled={deleteBlockText(r.order) !== undefined}
                          aria-label={t(
                            "transactions.deleteSaleAria",
                            "Delete {{code}}",
                            { code: r.code },
                          )}
                          icon={<DeleteOutlined />}
                          onClick={() => removeSale(r.order)}
                        />
                      </span>
                    </Tooltip>
                  </Flex>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <EditTransactionModal
        open={editing !== null}
        order={editing}
        onClose={() => setEditing(null)}
      />

      <ShopeeSettlementImport
        open={importing}
        pending={pendingShopeePayments(db, paymentsOf)}
        settledRefs={db.settlements
          .filter((s) =>
            db.orders
              .find((o) => o.id === s.orderId)
              ?.payments?.some(
                (p) => p.id === s.paymentId && p.state === "SETTLED",
              ),
          )
          .map(
            (s) =>
              db.orders
                .find((o) => o.id === s.orderId)
                ?.payments?.find((p) => p.id === s.paymentId)?.ref ?? "",
          )
          .filter((r) => r !== "")}
        onClose={() => setImporting(false)}
        onRecord={(drafts) => {
          let done = { written: 0, landed: 0 };
          const staff = currentStaffName();
          mutate((d) => {
            done = recordPayouts(d, "SHOPEE", drafts, {
              staff,
              at: new Date().toISOString(),
              nextId,
              appendEvent,
            });
          });
          message.success(
            t(
              "piutang.imported",
              "{{count}} payout(s) recorded — {{amount}}.",
              { count: done.written, amount: fmtRp(done.landed) },
            ),
          );
        }}
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
