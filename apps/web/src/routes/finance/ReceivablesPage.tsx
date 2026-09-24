/**
 * Pending Payment — money a marketplace is holding, one row per payment.
 *
 * ## One table (owner, 2026-09-23)
 *
 * > *"Make it just marketplace pending table (shopee, tokopedia), remove the
 * > 'owed by customer' table."*
 *
 * What a customer owes has its own screen — `/finance/receivable` — and having
 * it here as well meant two lists of the same debts drifting apart. This page
 * is now only the errand you do at a marketplace's dashboard.
 *
 * Pending rows sit on top, oldest sale first, because the oldest payout is the
 * one nobody has chased; withdrawn rows underneath, most recent first.
 * `Receive` records that row's payout alone, and `splitPayout`/`payoutsOf`
 * still make a settlement of one out of it — the database has always held one
 * `Settlement` per `Payment`.
 *
 * **Which money is "waiting" is Shopee and Tokopedia** (`holdsPendingMoney` in
 * `lib/channels.ts`, owner ask 2026-09-20). It used to be every payment in
 * PENDING, which let `legacyPayments` — one PENDING payment carrying the
 * ORDER's channel — file an unpaid walk-in here, money a person owes on the
 * table for money a platform holds.
 *
 * The Shopee upload (owner ask 2026-09-21) writes through the same `record` a
 * hand-typed withdrawal does, so a settlement made either way is the same row
 * and carries the same log.
 */
import { useMemo, useState } from "react";
import { App, Button, Card, Flex, Statistic, Tooltip, Typography } from "antd";
import {
  CheckCircleOutlined,
  EditOutlined,
  UploadOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { SettleModal } from "../../components/SettleModal";
import {
  ShopeeSettlementImport,
  pendingShopeePayments,
} from "./ShopeeSettlementImport.js";
import { PaymentsModal } from "../../components/PaymentsModal";
import { fmtRp, fmtDate, fmtDateTime, fmtNone } from "../../lib/format.js";
import { channelOf, holdsPendingMoney } from "../../lib/channels.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  payoutsOf,
  respreadPayout,
  settlementTotals,
  splitPayout,
  type Payout,
  type Settlement,
  type SettlementDraft,
  type SettlementFee,
} from "../../lib/marketplace.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
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

/**
 * One marketplace payment, waiting or withdrawn.
 *
 * Both halves of the table are this shape because they are the same fact at
 * two moments — a row does not change what it is when the money lands, it
 * gains a `settlement`.
 */
interface MarketRow {
  readonly key: string;
  readonly order: Order;
  readonly payment: SalePayment;
  readonly channel: string;
  /** The channel's own label, which is what the filter and the search read. */
  readonly channelLabel: string;
  readonly customer: string;
  /** When the sale happened. */
  readonly at: string;
  readonly gross: number;
  /** Absent while the marketplace is still holding it. */
  readonly settlement?: Settlement;
}

export function ReceivablesPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  /** The pending row being received. */
  const [receiving, setReceiving] = useState<MarketRow | null>(null);
  /** A recorded withdrawal being corrected. *"Then it is editable and logged."* */
  const [amending, setAmending] = useState<Payout | null>(null);
  const [editingPay, setEditingPay] = useState<Order | null>(null);
  /** The Shopee upload (owner ask 2026-09-21). See `ShopeeSettlementImport`. */
  const [importing, setImporting] = useState(false);

  const channelLabel = (channel: string) =>
    channelOf(channel)?.label ?? channel;

  const customerOf = (o: Order) =>
    o.customerId === null
      ? undefined
      : db.customers.find((c) => c.id === o.customerId);

  /**
   * Every marketplace payment: what is waiting, then what has been withdrawn.
   *
   * The waiting half comes off the PAYMENTS, because a payment in PENDING is
   * what "a marketplace is holding this" means. The withdrawn half comes off
   * the SETTLEMENTS rather than off settled payments, because a settlement is
   * the withdrawal document — the row that knows what was deducted and what
   * landed. A marketplace payment settled by hand in Transaction History has
   * no such document and belongs in neither list.
   */
  const market = useMemo<MarketRow[]>(() => {
    const orders = new Map(db.orders.map((o) => [o.id, o]));
    const row = (
      o: Order,
      p: SalePayment,
      settlement?: Settlement,
    ): MarketRow => {
      const channel = settlement?.channel ?? p.channel ?? o.source;
      return {
        key: `${o.id}-${p.id}`,
        order: o,
        payment: p,
        channel,
        channelLabel: channelLabel(channel),
        customer: customerOf(o)?.name ?? t("piutang.walkIn", "Walk-in"),
        at: o.ts,
        gross: settlement?.gross ?? p.amount,
        ...(settlement === undefined ? {} : { settlement }),
      };
    };

    const waiting: MarketRow[] = [];
    for (const o of db.orders) {
      for (const p of paymentsOf(o)) {
        if (p.state !== "PENDING") continue;
        // Shopee and Tokopedia only — see the header. Anything else waiting
        // is a person who has not paid, and belongs to the table below.
        if (!holdsPendingMoney(p.channel ?? o.source)) continue;
        waiting.push(row(o, p));
      }
    }
    const done: MarketRow[] = [];
    for (const s of db.settlements) {
      if (!holdsPendingMoney(s.channel)) continue;
      const o = orders.get(s.orderId);
      if (o === undefined) continue;
      const p = paymentsOf(o).find((x) => x.id === s.paymentId);
      if (p === undefined) continue;
      done.push(row(o, p, s));
    }
    // Waiting first — that is the half somebody is here to act on — oldest
    // sale first, because the oldest payout is the one nobody has chased.
    // Withdrawn underneath, most recently withdrawn first.
    waiting.sort((a, b) => a.at.localeCompare(b.at));
    done.sort((a, b) => b.settlement!.at.localeCompare(a.settlement!.at));
    return [...waiting, ...done];
  }, [db.orders, db.customers, db.settlements]);

  const pendingTotal = market
    .filter((r) => r.settlement === undefined)
    .reduce((n, r) => n + r.gross, 0);

  /**
   * Write settlements: the money lands, and the deductions are kept.
   *
   * The ONE writer, and ONE `mutate`, because the payments, their `settled`
   * projections and the settlement documents have to move together. A payout
   * half-recorded would leave a sale showing as pending against money that is
   * already in the bank.
   *
   * Per draft, i.e. per PAYMENT:
   *
   * - the payment flips PENDING → SETTLED, dated now — which is what puts it
   *   in the bank's balance (`lib/accounts.ts` builds balances from payments),
   *   and nothing about the order's total changes;
   * - `grossTotal` / `netReceived` record what the SALE netted: its total less
   *   what the platform kept of this payment. On a split sale — half cash,
   *   half Shopee — that is the total less the Shopee part's deductions, not
   *   the Shopee part alone;
   * - one `Settlement` and its RECORDED log row.
   *
   * A payment that is no longer pending when the write happens — another till
   * recorded it a moment ago — is skipped rather than settled twice, and the
   * caller is told how many were.
   */
  const record = (
    channel: string,
    drafts: readonly SettlementDraft[],
  ): { written: number; landed: number } => {
    const at = new Date().toISOString();
    const staff = currentStaffName();
    let written = 0;
    let landed = 0;
    mutate((d: MockDb) => {
      for (const s of drafts) {
        const o = d.orders.find((x) => x.id === s.orderId);
        if (!o) continue;
        const parts = paymentsOf(o);
        const target = parts.find((p) => p.id === s.paymentId);
        if (target === undefined || target.state !== "PENDING") continue;
        const next = parts.map((p) =>
          p.id === s.paymentId ? { ...p, state: "SETTLED" as const, at } : p,
        );
        o.payments = next;
        o.settled = next.every((p) => p.state === "SETTLED");
        if (s.received !== s.gross) {
          o.grossTotal = o.grossTotal ?? o.total;
          o.netReceived = (o.netReceived ?? o.total) - (s.gross - s.received);
        }
        // The sale's own timeline should say the money arrived — it is the
        // one place somebody chasing a serial will look.
        for (const serial of o.serials) {
          appendEvent(d, serial, {
            type: "DICATAT",
            refCode: o.code,
            note: `Withdrawal from ${channelLabel(channel)}: ${fmtRp(s.received)}`,
          });
        }
        const id = nextId("stl");
        const totals = settlementTotals({
          gross: s.gross,
          fees: s.fees,
          received: s.received,
        });
        d.settlements.push({
          id,
          paymentId: s.paymentId,
          orderId: s.orderId,
          channel,
          gross: s.gross,
          fees: s.fees,
          received: s.received,
          ...(s.reason ? { reason: s.reason } : {}),
          at,
          staff,
        });
        d.settlementLog.push({
          id: nextId("slog"),
          settlementId: id,
          at,
          staff,
          action: "RECORDED",
          after: { received: totals.received, deducted: totals.deducted },
          ...(s.reason ? { reason: s.reason } : {}),
        });
        written += 1;
        landed += s.received;
      }
    });
    return { written, landed };
  };

  /**
   * "Receive": one row's payout, recorded.
   *
   * Still through `splitPayout` although there is only ever one part — it is
   * what decides a settlement's fee rows and its share of any discrepancy, and
   * a second copy of that arithmetic for the single case is a second place for
   * it to drift.
   */
  const receive = (
    what: MarketRow,
    result: { fees: SettlementFee[]; received: number },
  ) => {
    const drafts = splitPayout(
      [
        {
          paymentId: what.payment.id,
          orderId: what.order.id,
          gross: what.payment.amount,
        },
      ],
      { fees: result.fees, received: result.received },
      () => nextId("fee"),
    );
    const done = record(what.channel, drafts);
    setReceiving(null);
    // Said outside the write, never inside it.
    if (done.written > 0) {
      message.success(
        t("piutang.settled", "{{amount}} recorded from {{channel}}.", {
          amount: fmtRp(done.landed),
          channel: channelLabel(what.channel),
        }),
      );
    } else {
      message.warning(
        t(
          "piutang.alreadyReceived",
          "This payout had already been recorded as received.",
        ),
      );
    }
  };

  /**
   * Correct a withdrawal that was recorded wrongly.
   *
   * The money has already landed and the sale is already settled — what is
   * being corrected is the SHOP'S ACCOUNT of it: which deduction was which,
   * and how much therefore arrived. So this rewrites the settlement and
   * appends an AMENDED log row carrying both figures, and does not touch the
   * payment.
   */
  const amend = (
    payout: Payout,
    result: { fees: SettlementFee[]; received: number },
  ) => {
    const next = respreadPayout(payout, result, () => nextId("fee"));
    const at = new Date().toISOString();
    const staff = currentStaffName();
    mutate((d) => {
      next.forEach((s, i) => {
        const was = payout.settlements[i]!;
        const before = settlementTotals({
          gross: was.gross,
          fees: was.fees,
          received: was.received,
        });
        const after = settlementTotals({
          gross: s.gross,
          fees: s.fees,
          received: s.received,
        });
        const index = d.settlements.findIndex((x) => x.id === s.id);
        if (index >= 0) d.settlements[index] = s;
        d.settlementLog.push({
          id: nextId("slog"),
          settlementId: s.id,
          at,
          staff,
          action: "AMENDED",
          before: { received: before.received, deducted: before.deducted },
          after: { received: after.received, deducted: after.deducted },
          ...(s.reason ? { reason: s.reason } : {}),
        });
      });
    });
    setAmending(null);
    message.success(t("piutang.amended", "Withdrawal corrected."));
  };

  /**
   * Save a correction to what a customer paid, and the log rows that make it
   * safe — the same writer Transaction History uses, for the same reason the
   * dialog is shared (owner ask 2026-09-08).
   *
   * One `mutate`: the payments, the `settled` projection over them and every
   * log row go together, exactly as a unit's event and its projection do.
   */
  const savePayments = (order: Order, next: SalePayment[]) => {
    const rows = diffPayments(paymentsOf(order), next, {
      at: new Date().toISOString(),
      staff: currentStaffName(),
    });
    mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      if (!o) return;
      o.payments = next;
      // Against the bill AFTER returns, net of what was handed back.
      o.settled = isSettled(billAfterReturns(o), next, refundedOf(o));
      for (const row of rows) d.paymentLog.push({ id: nextId("plog"), ...row });
    });
    setEditingPay(null);
    message.success(
      rows.length === 0
        ? t("piutang.payUnchanged", "Nothing changed.")
        : t("piutang.payLogged", "{{n}} change(s) recorded.", {
            n: rows.length,
          }),
    );
  };

  /** What a row shows in the Received column: waiting, or what landed. */
  const receivedCell = (r: MarketRow) => {
    if (r.settlement === undefined) {
      // Zero, not a prediction. It used to say "~Rp7.704.000 after 10%", and
      // the owner's answer is that the cut is not always 10% and is nobody's
      // to guess (2026-09-20) — a figure the screen invents is one somebody
      // has to check before they can trust the one beside it.
      return <Typography.Text type="warning">{fmtRp(0)}</Typography.Text>;
    }
    const s = r.settlement;
    const totals = settlementTotals({
      gross: s.gross,
      fees: s.fees,
      received: s.received,
    });
    const note = r.payment.note?.trim();
    return (
      <Flex vertical align="flex-end" gap={0}>
        <Typography.Text strong>{fmtRp(s.received)}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t("piutang.lessDeductions", "less {{amount}}", {
            amount: fmtRp(totals.deducted),
          })}
          {s.fees.length > 0 &&
            ` · ${s.fees.map((f) => f.label?.trim() || f.kind).join(" · ")}`}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {fmtDateTime(s.at)}
        </Typography.Text>
        {s.reason?.trim() && (
          <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
            {s.reason}
          </Typography.Text>
        )}
        {note && (
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {note}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  return (
    <PageContainer title={t("piutang.title", "Pending Payment")}>
      <Flex vertical gap={SPACE.md}>
        <Card>
          <Statistic
            title={t("piutang.withMarketplaces", "With marketplaces")}
            value={fmtRp(pendingTotal)}
            styles={{ content: { color: "#d48806" } }}
          />
        </Card>

        <Card
          title={t("piutang.marketplaceMoney", "Waiting at a marketplace")}
          extra={
            <Button
              icon={<UploadOutlined />}
              onClick={() => setImporting(true)}
            >
              {t("piutang.uploadShopee", "Upload a Shopee report")}
            </Button>
          }
        >
          <ProTable<MarketRow>
            persistKey="pending.marketplace"
            rowKey="key"
            dataSource={market}
            searchPlaceholder={t(
              "piutang.searchOrders",
              "Search an order number or reference",
            )}
            locale={{
              emptyText: t(
                "piutang.noPending",
                "Every marketplace has paid out.",
              ),
            }}
            columns={[
              {
                title: t("piutang.channel", "Channel"),
                key: "channel",
                width: 140,
                facet: true,
                facetLabel: t("piutang.anyChannel", "Any channel"),
                facetValue: (r) => r.channelLabel,
                sortValue: (r) => r.channelLabel,
                render: (_, r) => (
                  <Typography.Text strong>{r.channelLabel}</Typography.Text>
                ),
              },
              {
                title: t("piutang.transactionNo", "Transaction number"),
                key: "order",
                width: 180,
                searchable: true,
                searchValue: (r) => r.order.code,
                sortValue: (r) => r.order.code,
                render: (_, r) => (
                  <Link to="/finance/transactions">{r.order.code}</Link>
                ),
              },
              {
                /*
                 * The marketplace's own order number — what its dashboard and
                 * its statement name a payout by, and therefore what somebody
                 * reconciling one is holding in their other hand.
                 */
                title: t("piutang.refNo", "Reference number"),
                key: "ref",
                width: 190,
                searchable: true,
                searchValue: (r) => r.payment.ref ?? "",
                sortValue: (r) => r.payment.ref ?? "",
                render: (_, r) => (
                  <Typography.Text
                    type={r.payment.ref?.trim() ? undefined : "secondary"}
                    style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
                  >
                    {r.payment.ref?.trim() || fmtNone()}
                  </Typography.Text>
                ),
              },
              {
                title: t("piutang.customer", "Customer"),
                key: "customer",
                width: 170,
                searchable: true,
                searchValue: (r) => r.customer,
                sortValue: (r) => r.customer,
                render: (_, r) => r.customer,
              },
              {
                title: t("piutang.when", "Date"),
                key: "at",
                width: 130,
                sortValue: (r) => Date.parse(r.at),
                render: (_, r) => fmtDate(r.at),
              },
              {
                title: t("piutang.amount", "Amount"),
                key: "amount",
                width: 160,
                align: "right",
                sortValue: (r) => r.gross,
                render: (_, r) => fmtRp(r.gross),
              },
              {
                title: t("piutang.landed", "Received"),
                key: "received",
                width: 230,
                align: "right",
                sortValue: (r) => r.settlement?.received ?? -1,
                render: (_, r) => receivedCell(r),
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                //
                // Two icon buttons on EVERY row, waiting or not (owner ask
                // 2026-09-20). The first is whichever of receive/correct the
                // row is up to; the second is the payment history, which a
                // customer can ring about before a payout has cleared. Icons
                // on both, because a labelled button on one row beside a bare
                // symbol on the next reads as two different kinds of row.
                title: "",
                key: "actions",
                width: 96,
                render: (_, r) => (
                  <Flex gap={4}>
                    {r.settlement === undefined ? (
                      <Tooltip
                        title={t(
                          "piutang.receive",
                          "Mark this payout as received",
                        )}
                      >
                        <Button
                          size="small"
                          icon={<CheckCircleOutlined />}
                          aria-label={t(
                            "piutang.receiveAria",
                            "Receive the payout for {{code}}",
                            { code: r.order.code },
                          )}
                          onClick={() => setReceiving(r)}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip
                        title={t("piutang.amend", "Correct this withdrawal")}
                      >
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={t(
                            "piutang.amendSaleAria",
                            "Correct the withdrawal for {{code}}",
                            { code: r.order.code },
                          )}
                          onClick={() =>
                            setAmending(payoutsOf([r.settlement!])[0]!)
                          }
                        />
                      </Tooltip>
                    )}
                    <Tooltip
                      title={t(
                        "piutang.openPayments",
                        "Payment history — record, correct or remove a payment",
                      )}
                    >
                      <Button
                        size="small"
                        icon={<WalletOutlined />}
                        aria-label={t(
                          "piutang.openPaymentsAria",
                          "Payments on {{code}}",
                          { code: r.order.code },
                        )}
                        onClick={() => setEditingPay(r.order)}
                      />
                    </Tooltip>
                  </Flex>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <SettleModal
        open={amending !== null}
        channel={amending?.channel ?? ""}
        gross={amending?.gross ?? 0}
        {...(amending ? { existing: { fees: amending.fees } } : {})}
        onClose={() => setAmending(null)}
        onSave={(result) => amending && amend(amending, result)}
      />

      <SettleModal
        open={receiving !== null}
        channel={receiving?.channel ?? ""}
        gross={receiving?.payment.amount ?? 0}
        {...(receiving
          ? {
              subject: [receiving.order.code, receiving.payment.ref?.trim()]
                .filter(Boolean)
                .join(" · "),
            }
          : {})}
        onClose={() => setReceiving(null)}
        onSave={(result) => receiving && receive(receiving, result)}
      />

      {/*
        The upload (owner ask 2026-09-21). It writes through the SAME `record`
        a hand-typed withdrawal writes through, so a settlement made here is
        indistinguishable from one typed in — including its `SettlementLog`
        row, and including the pencil that corrects it.
      */}
      <ShopeeSettlementImport
        open={importing}
        pending={pendingShopeePayments(db, paymentsOf)}
        settledRefs={db.settlements
          .map(
            (s) =>
              db.orders
                .find((o) => o.id === s.orderId)
                ?.payments?.find((p) => p.id === s.paymentId)?.ref ?? "",
          )
          .filter((r) => r !== "")}
        onClose={() => setImporting(false)}
        onRecord={(drafts) => {
          const done = record("SHOPEE", drafts);
          message.success(
            t(
              "piutang.imported",
              "{{count}} payout(s) recorded — {{amount}}.",
              {
                count: done.written,
                amount: fmtRp(done.landed),
              },
            ),
          );
        }}
      />

      {/* Deliberately the same dialog Transaction History and the customer
          drawer open (2026-09-09): a payment recorded from any of them is the
          same event, and has to write the same log. */}
      <PaymentsModal
        open={editingPay !== null}
        orderId={editingPay?.id ?? ""}
        code={editingPay?.code ?? ""}
        total={editingPay ? billAfterReturns(editingPay) : 0}
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
        onClose={() => setEditingPay(null)}
        onSave={(next) => editingPay && savePayments(editingPay, next)}
      />
    </PageContainer>
  );
}
