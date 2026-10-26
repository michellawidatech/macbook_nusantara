/**
 * Recording one payment against a supplier's or a customer's debts — the
 * dialog behind *Add payment*, a party's *Record payment* and a document's, on
 * Payable and Receivable (owner ask 2026-09-22, widened 2026-09-24).
 *
 * > *"The user will fill the supplier/customer, the amount, and a table of the
 * > transaction of that supplier (clickable transaction number | price owed |
 * > paid), sorted from the oldest transaction … On top of the table show how
 * > many invoice/inbound is selected and the total amount."*
 *
 * How the money spreads is `lib/allocatePayment.ts` (oldest first; only the
 * total is typed, and the newest bill takes a cut). What the money becomes on
 * each document is `lib/debtPayments.ts`. This file is the form, and the one
 * mutation that writes every part of the payment together.
 *
 * ## The balance switch
 *
 * *"The user can decide if the payment will deduct the bank balance or not."*
 * On, the money moves the pot its method belongs to — cash is the drawer, a
 * transfer is the bank — and the row appears on Income & Expense's balance.
 * Off, it settles the debt and moves nothing: the owner paid from their own
 * account, a customer paid a friend's. `Payment.inBalance`, on every part.
 *
 * ## More than is owed (owner answer 2026-09-22)
 *
 * A supplier's remainder becomes an unallocated deposit, which `/suppliers`
 * already knows how to put against a later invoice. A customer has nowhere
 * for credit to live, so the dialog refuses to take more than they owe.
 *
 * ## Where the ticks come from (owner ask 2026-09-24)
 *
 * *"The 'catat pembayaran' button should be on supplier level or transaction
 * level, and it will autofill the transaction detail accordingly."* A party's
 * button hands in every document under it (`DebtPaymentTarget.rowKeys`), so
 * the amount box opens at the whole account; a document's hands in its own.
 *
 * ## Starting from the document (owner ask 2026-09-24)
 *
 * *"When adding receivables payment, they can start from transaction instead
 * of the customer."* The person at the desk is holding a receipt, not a
 * name: a second box beside the party's finds a document by its number — the
 * shop's code, the marketplace's order number, the supplier's invoice number
 * — and picking one fills the party in and ticks that row. A second pick of
 * the same party's document adds to the ticks; one of another party's
 * switches to them. The same box on Payable finds an inbound number, because
 * the dialog is one component and the question is the same.
 *
 * It is also the only way into a walk-in sale's debt from *Add payment*: the
 * walk-in heading is strangers, so it is not on the party list, but a
 * receipt in hand names exactly one of them.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Typography,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MoneyInput } from "../../components/MoneyInput";
import { InvoiceModal } from "../../components/Invoice";
import { fmtDate, fmtRp } from "../../lib/format.js";
import { accountOfMethod, isPickableMethod } from "../../lib/accounts.js";
import { isSaleLocked } from "../../lib/bookClose.js";
import {
  EMPTY_ALLOCATION,
  allocate,
  setAmount,
  toggleRow,
  type AllocationLine,
  type AllocationState,
} from "../../lib/allocatePayment.js";
import {
  invoicePaymentParts,
  openingPayment,
  salePaymentsAfter,
  type PaymentBase,
} from "../../lib/debtPayments.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  payableGroups,
  receivableGroups,
} from "../../lib/payableReceivable.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
} from "../../lib/salePayments.js";
import { paymentRefOf } from "../../lib/saleStatus.js";
import { currentStaffName, mutate, nextId, useDb } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

export type DebtSide = "PAYABLE" | "RECEIVABLE";

/**
 * Where the dialog opens: a party, and which of their documents to tick.
 *
 * `rowKeys` is what makes the two buttons of 2026-09-24 different. A
 * document's *Record payment* passes its own key; a PARTY's passes every
 * document under it, so the amount box opens at what that supplier or
 * customer is owed in total — *"it will autofill the transaction detail
 * accordingly"*. `{partyId: ""}` is *Add payment*: nobody chosen, nothing
 * ticked.
 */
export interface DebtPaymentTarget {
  readonly partyId: string;
  readonly rowKeys?: readonly string[];
}

/** The walk-in heading `receivableGroups` files nameless sales under. */
const WALK_IN = "walk-in";

/** One row of the dialog's table, whichever side it is on. */
interface Doc {
  readonly key: string;
  readonly code: string;
  readonly at: string;
  readonly owed: number;
  readonly opening: boolean;
  /** The party it is filed under — what picking it in the finder chooses. */
  readonly partyId: string;
  readonly partyName: string;
  /**
   * What the finder matches, lower-cased: the shop's code, the other side's
   * number (a marketplace order, a supplier's invoice) and the party.
   */
  readonly search: string;
}

/** An option of the document finder. */
interface DocOption {
  readonly value: string;
  readonly label: string;
  readonly party: string;
  readonly owed: number;
  readonly search: string;
}

const searchable = (...parts: readonly (string | undefined)[]) =>
  parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .join(" ")
    .toLowerCase();

/** The methods a debt may be paid through: cash and transfer. */
const DEBT_METHOD_CODES = ["TUNAI", "TRANSFER"];

export function DebtPaymentModal({
  side,
  target,
  onClose,
}: {
  readonly side: DebtSide;
  /** Null keeps the dialog closed; `{partyId: ""}` opens it with nobody chosen. */
  readonly target: DebtPaymentTarget | null;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const db = useDb();
  const {
    token: { colorTextSecondary },
  } = theme.useToken();
  const payable = side === "PAYABLE";
  const walkIn = t("utang.walkIn", "Walk-in customers");

  /** Every party with a debt, and the documents behind each, oldest first. */
  const groups = useMemo(
    () =>
      payable
        ? payableGroups(db.pos, db.suppliers).map((g) => {
            const name =
              g.supplierName || t("utang.noSupplier", "No supplier named");
            return {
              id: g.supplierId,
              name,
              phone: "",
              owed: g.owed,
              docs: g.rows.map<Doc>((r) => ({
                key: r.key,
                code: r.code,
                at: r.at,
                owed: r.owed,
                // A supplier's debt is its invoices and nothing before them
                // since 2026-09-24; `Supplier.openingBalance` is gone.
                opening: false,
                partyId: g.supplierId,
                partyName: name,
                search: searchable(r.code, r.invoiceNo, name),
              })),
            };
          })
        : receivableGroups(
            /*
             * Not a sale the book is closed over (owner answer 2026-09-24): a
             * closed period takes no further money, so offering the row here
             * would be a tick that could never be saved. The rows come back
             * when the book is reopened.
             */
            db.orders.filter((o) => !isSaleLocked(o, db.settings)),
            db.customers,
            walkIn,
          ).map((g) => ({
            id: g.customerId,
            name: g.customerName,
            phone: g.phone,
            owed: g.owed,
            // Oldest first, whatever order the call list keeps.
            docs: g.rows.map<Doc>((r) => {
              const sale = db.orders.find((o) => o.id === r.key);
              return {
                key: r.key,
                code: r.code,
                at: r.at,
                owed: r.owed,
                opening: r.opening,
                partyId: g.customerId,
                partyName: g.customerName,
                search: searchable(
                  r.code,
                  sale ? paymentRefOf(paymentsOf(sale)) : undefined,
                  g.customerName,
                  g.phone,
                ),
              };
            }),
          })),
    [
      payable,
      db.pos,
      db.suppliers,
      db.orders,
      db.customers,
      db.settings,
      walkIn,
      t,
    ],
  );
  /**
   * Every document with money owed on it, across every party, newest first —
   * what the finder offers. An old debt has no number to find it by.
   */
  const allDocs = useMemo(
    () =>
      groups
        .flatMap((g) => g.docs)
        .filter((d) => !d.opening)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [groups],
  );

  const [partyId, setPartyId] = useState("");
  const [alloc, setAlloc] = useState<AllocationState>(EMPTY_ALLOCATION);
  const [method, setMethod] = useState("TRANSFER");
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [inBalance, setInBalance] = useState(true);
  const [note, setNote] = useState("");
  /** The document the dialog was started from, if any — what the finder shows. */
  const [docKey, setDocKey] = useState<string | undefined>(undefined);
  /** The one walk-in sale on offer, when the party is the walk-in heading. */
  const [walkInKey, setWalkInKey] = useState<string | undefined>(undefined);
  /** The sale a transaction number opened, over this dialog. */
  const [viewing, setViewing] = useState<Order | null>(null);

  // Re-seeded when the dialog opens, not whenever the store moves — a poll
  // from another till must not wipe what somebody is typing.
  useEffect(() => {
    if (!target) return;
    const picked = target.rowKeys ?? [];
    setPartyId(target.partyId);
    setAlloc(
      picked.length > 0
        ? { ...EMPTY_ALLOCATION, picked: [...picked] }
        : EMPTY_ALLOCATION,
    );
    // The finder shows where we started only when that is ONE document: a
    // whole party's worth of ticks is not a document anybody started from.
    setDocKey(picked.length === 1 ? picked[0] : undefined);
    setWalkInKey(
      target.partyId === WALK_IN && picked.length === 1 ? picked[0] : undefined,
    );
    setMethod("TRANSFER");
    setDay(dayjs());
    setInBalance(true);
    setNote("");
  }, [target]);

  const group = groups.find((g) => g.id === partyId);
  /**
   * The documents on offer. A walk-in "customer" is everybody who bought
   * without a name, so spreading one person's money over the heading would pay
   * strangers' bills: opened from a walk-in row — or started from one in the
   * finder — the dialog offers that row.
   */
  const docs = useMemo<readonly Doc[]>(() => {
    const all = group?.docs ?? [];
    if (partyId === WALK_IN && walkInKey)
      return all.filter((d) => d.key === walkInKey);
    return all;
  }, [group, partyId, walkInKey]);

  /** The party was picked by hand: the finder no longer says where we started. */
  const pickParty = (v: string) => {
    setPartyId(v);
    setAlloc(EMPTY_ALLOCATION);
    setDocKey(undefined);
    setWalkInKey(undefined);
  };
  /**
   * A document was picked in the finder: its party fills in and the row is
   * ticked. Another of the same party's adds to the ticks; another party's
   * starts over on them.
   */
  const pickDoc = (key: string) => {
    const doc = allDocs.find((d) => d.key === key);
    if (!doc) return;
    setDocKey(key);
    setWalkInKey(doc.partyId === WALK_IN ? key : undefined);
    if (doc.partyId !== partyId) {
      setPartyId(doc.partyId);
      setAlloc({ ...EMPTY_ALLOCATION, picked: [key] });
    } else {
      setAlloc((s) => ({
        ...s,
        picked: s.picked.includes(key) ? s.picked : [...s.picked, key],
        skipped: s.skipped.filter((k) => k !== key),
      }));
    }
  };
  const docOptions = allDocs.map<DocOption>((d) => ({
    value: d.key,
    label: d.code,
    party: d.partyName,
    owed: d.owed,
    search: d.search,
  }));
  /** An old debt opened from its row has no number: the finder stays empty. */
  const docShown = allDocs.some((d) => d.key === docKey) ? docKey : undefined;

  const result = allocate(docs, alloc);
  const lineOf = new Map(result.lines.map((l) => [l.key, l]));
  const partyOwed = docs.reduce((n, d) => n + d.owed, 0);
  /** A supplier's remainder is a deposit; `po:` groups have no supplier to hold one. */
  const canDeposit = payable && partyId !== "" && !partyId.startsWith("po:");
  const overpaid = result.leftover > 0;
  const refused = overpaid && !canDeposit;

  const methods = db.paymentMethods
    .filter(
      (m) =>
        m.active && (payable ? m.forPo : m.forSale) && isPickableMethod(m.code),
    )
    .filter((m) => DEBT_METHOD_CODES.includes(m.code));
  const pot = accountOfMethod(method);

  const partyOptions = groups
    .filter(
      (g) => g.id === partyId || (g.id !== WALK_IN && !g.id.startsWith("po:")),
    )
    .map((g) => ({
      value: g.id,
      label: g.phone ? `${g.name} · ${g.phone}` : g.name,
      owed: g.owed,
    }));

  const save = () => {
    const at = day.isSame(dayjs(), "day")
      ? new Date().toISOString()
      : day.hour(12).minute(0).second(0).millisecond(0).toISOString();
    const base: PaymentBase = {
      method,
      at,
      inBalance,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const paying = result.lines.filter((l) => l.paid > 0);
    const docOf = new Map(docs.map((d) => [d.key, d]));
    const staff = currentStaffName();
    void mutate((d) => {
      for (const line of paying) {
        const doc = docOf.get(line.key);
        if (!doc) continue;
        if (doc.opening) {
          // Customers only: a supplier's old debt went on 2026-09-24 with
          // `Supplier.openingBalance`, so `opening` is never true on Payable.
          const party = d.customers.find((c) => c.id === partyId);
          if (!party) continue;
          party.openingPayments = [
            ...(party.openingPayments ?? []),
            openingPayment(line.paid, base, nextId("opay")),
          ];
        } else if (payable) {
          const po = d.pos.find((p) => p.id === doc.key);
          if (!po) continue;
          po.payments.push(
            ...invoicePaymentParts(po, line.paid, base, () => nextId("pp")),
          );
        } else {
          const o = d.orders.find((x) => x.id === doc.key);
          if (!o) continue;
          const before = paymentsOf(o);
          const next = salePaymentsAfter(o, line.paid, base, nextId("pay"));
          const log = diffPayments(before, next, {
            at,
            staff,
            reason: t("debtPay.logReason", "Payment recorded on Receivable"),
          });
          o.payments = next;
          // A projection over the payments, in the same mutation.
          o.settled = isSettled(billAfterReturns(o), next, refundedOf(o));
          for (const row of log)
            d.paymentLog.push({ id: nextId("plog"), ...row });
        }
      }
      if (canDeposit && result.leftover > 0) {
        d.deposits.push({
          id: nextId("dep"),
          supplierId: partyId,
          amount: result.leftover,
          method,
          at,
          note:
            base.note ??
            t("debtPay.depositNote", "Paid above the invoices on Payable"),
          staff,
          allocations: [],
          ...(inBalance ? {} : { inBalance: false }),
        });
      }
    });
    message.success(
      t("debtPay.saved", "{{amount}} recorded against {{count}} document(s).", {
        amount: fmtRp(result.allocated),
        count: paying.length,
      }),
    );
    onClose();
  };

  /** Green in full, yellow in part, nothing otherwise (owner ask). */
  const rowClass = (l: AllocationLine | undefined) =>
    l?.status === "FULL"
      ? "debt-row-full"
      : l?.status === "PARTIAL"
        ? "debt-row-partial"
        : "";

  const docLabel = payable
    ? t("debtPay.invoices", "invoice(s)")
    : t("debtPay.transactions", "transaction(s)");

  return (
    <>
      <Modal
        open={target !== null}
        onCancel={onClose}
        width={760}
        title={
          payable
            ? t("debtPay.titlePayable", "Pay a supplier")
            : t("debtPay.titleReceivable", "Receive a customer's payment")
        }
        okText={t("debtPay.save", "Record payment")}
        okButtonProps={{
          disabled: partyId === "" || result.amount <= 0 || refused || !method,
        }}
        onOk={save}
        destroyOnHidden
      >
        <Form layout="vertical" component="div">
          <Flex gap={SPACE.md} wrap>
            <Form.Item
              label={
                payable
                  ? t("utang.supplier", "Supplier")
                  : t("utang.customer", "Customer")
              }
              required
              style={{ flex: "1 1 260px", marginBottom: SPACE.sm }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                value={partyId || undefined}
                placeholder={
                  payable
                    ? t("debtPay.pickSupplier", "Pick a supplier")
                    : t("debtPay.pickCustomer", "Pick a customer")
                }
                onChange={pickParty}
                options={partyOptions}
                optionRender={(o) => (
                  <Flex justify="space-between" gap={SPACE.sm}>
                    <span>{o.data.label}</span>
                    <Typography.Text type="secondary">
                      {fmtRp(o.data.owed)}
                    </Typography.Text>
                  </Flex>
                )}
              />
            </Form.Item>
            {/* The other way in: the document's number (owner ask
                2026-09-24). See the header. */}
            <Form.Item
              label={
                payable
                  ? t("debtPay.fromInvoice", "Or start from an inbound number")
                  : t("debtPay.fromTransaction", "Or start from a transaction")
              }
              style={{ flex: "1 1 260px", marginBottom: SPACE.sm }}
            >
              <Select<string, DocOption>
                showSearch
                aria-label={
                  payable
                    ? t("utang.inboundNumber", "Inbound number")
                    : t("utang.transactionId", "Transaction ID")
                }
                value={docShown}
                placeholder={
                  payable
                    ? t("debtPay.findInvoice", "Type an inbound number")
                    : t(
                        "debtPay.findTransaction",
                        "Type a transaction or order number",
                      )
                }
                onChange={pickDoc}
                options={docOptions}
                filterOption={(input, o) =>
                  (o?.search ?? "").includes(input.trim().toLowerCase())
                }
                optionRender={(o) => (
                  <Flex justify="space-between" gap={SPACE.sm}>
                    <span>
                      {o.data.label} · {o.data.party}
                    </span>
                    <Typography.Text type="secondary">
                      {fmtRp(o.data.owed)}
                    </Typography.Text>
                  </Flex>
                )}
                notFoundContent={t(
                  "debtPay.noSuchDocument",
                  "Nothing owed under that number.",
                )}
              />
            </Form.Item>
          </Flex>
          <Flex gap={SPACE.md} wrap>
            <Form.Item
              label={t("debtPay.amount", "Amount")}
              required
              extra={
                result.auto && result.amount > 0
                  ? t("debtPay.amountAuto", "Added up from the ticked rows.")
                  : undefined
              }
              style={{ flex: "1 1 200px", marginBottom: SPACE.sm }}
            >
              <MoneyInput
                aria-label={t("debtPay.amount", "Amount")}
                value={
                  result.auto && result.amount === 0 ? undefined : result.amount
                }
                onChange={(v) => setAlloc((s) => setAmount(s, v))}
                placeholder={t(
                  "debtPay.amountPlaceholder",
                  "Type it, or tick the rows",
                )}
                disabled={partyId === ""}
              />
            </Form.Item>
            <Form.Item
              label={t("debtPay.method", "Paid by")}
              required
              style={{ flex: "1 1 160px", marginBottom: SPACE.sm }}
            >
              <Select
                value={method}
                onChange={setMethod}
                options={methods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
              />
            </Form.Item>
            <Form.Item
              label={t("debtPay.date", "Date")}
              required
              style={{ flex: "1 1 160px", marginBottom: SPACE.sm }}
            >
              <DatePicker
                value={day}
                onChange={(v) => v && setDay(v)}
                allowClear={false}
                format="DD MMM YYYY"
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item
              label={t("debtPay.note", "Note")}
              style={{ flex: "2 1 220px", marginBottom: SPACE.sm }}
            >
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Form.Item>
          </Flex>
          <Flex
            align="flex-start"
            gap={SPACE.sm}
            style={{ marginBottom: SPACE.md }}
          >
            <Switch
              checked={inBalance}
              onChange={setInBalance}
              aria-label={t(
                "debtPay.inBalance",
                "Counts in the shop's balance",
              )}
            />
            <Flex vertical gap={0}>
              <Typography.Text>
                {t("debtPay.inBalance", "Counts in the shop's balance")}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {!inBalance
                  ? t(
                      "debtPay.inBalanceOff",
                      "Settles the debt without moving the cash or bank balance — for money that never passed through the shop's accounts.",
                    )
                  : payable
                    ? pot === "CASH"
                      ? t("debtPay.outOfCash", "Comes out of the cash drawer.")
                      : t("debtPay.outOfBank", "Comes out of the bank balance.")
                    : pot === "CASH"
                      ? t("debtPay.intoCash", "Goes into the cash drawer.")
                      : t("debtPay.intoBank", "Goes into the bank balance.")}
              </Typography.Text>
            </Flex>
          </Flex>
        </Form>

        {partyId !== "" && (
          <Flex vertical gap={SPACE.sm}>
            <Flex justify="space-between" align="baseline" wrap gap={SPACE.sm}>
              <Typography.Text strong>
                {t(
                  "debtPay.selected",
                  "{{count}} {{what}} selected · {{amount}}",
                  {
                    count: result.count,
                    what: docLabel,
                    amount: fmtRp(result.allocated),
                  },
                )}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t("debtPay.owedInAll", "Owed in all: {{amount}}", {
                  amount: fmtRp(partyOwed),
                })}
              </Typography.Text>
            </Flex>
            {overpaid &&
              (canDeposit ? (
                <Alert
                  type="info"
                  showIcon
                  title={t(
                    "debtPay.toDeposit",
                    "{{amount}} is more than these invoices owe. It is kept as a deposit with {{name}}, to put against a later invoice.",
                    { amount: fmtRp(result.leftover), name: group?.name ?? "" },
                  )}
                />
              ) : (
                <Alert
                  type="error"
                  showIcon
                  title={
                    payable
                      ? t(
                          "debtPay.tooMuchInvoice",
                          "{{amount}} is more than this invoice owes.",
                          { amount: fmtRp(result.leftover) },
                        )
                      : t(
                          "debtPay.tooMuch",
                          "{{amount}} is more than {{name}} owes. A customer cannot be paid ahead.",
                          {
                            amount: fmtRp(result.leftover),
                            name: group?.name ?? "",
                          },
                        )
                  }
                />
              ))}
            <Table<Doc>
              size="small"
              rowKey="key"
              dataSource={[...docs]}
              pagination={false}
              scroll={{ y: 360 }}
              rowClassName={(r) => rowClass(lineOf.get(r.key))}
              rowSelection={{
                hideSelectAll: true,
                selectedRowKeys: result.lines
                  .filter((l) => l.ticked)
                  .map((l) => l.key),
                onSelect: (r) => setAlloc((s) => toggleRow(s, result, r.key)),
                getCheckboxProps: (r) => ({
                  "aria-label": t("debtPay.pickRow", "Pay {{code}}", {
                    code: r.opening
                      ? t("utang.fromBefore", "From before this app")
                      : r.code,
                  }),
                }),
              }}
              locale={{
                emptyText: t("debtPay.nothingOwed", "Nothing is owed."),
              }}
              columns={[
                {
                  title: payable
                    ? t("utang.inboundNumber", "Inbound number")
                    : t("utang.transactionId", "Transaction ID"),
                  key: "code",
                  render: (_, r) => (
                    <Flex vertical gap={0}>
                      {r.opening ? (
                        <Typography.Text>
                          {t("utang.fromBefore", "From before this app")}
                        </Typography.Text>
                      ) : payable ? (
                        // A new browser tab: the dialog, and what is typed in
                        // it, stays where it is.
                        <Link
                          to={`/inbound/${r.key}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.code}
                        </Link>
                      ) : (
                        <Typography.Link
                          onClick={() =>
                            setViewing(
                              db.orders.find((o) => o.id === r.key) ?? null,
                            )
                          }
                        >
                          {r.code}
                        </Typography.Link>
                      )}
                      {r.at && (
                        <Typography.Text
                          style={{
                            fontSize: TYPE.sm,
                            color: colorTextSecondary,
                          }}
                        >
                          {fmtDate(r.at)}
                        </Typography.Text>
                      )}
                    </Flex>
                  ),
                },
                {
                  title: t("debtPay.owed", "Owed"),
                  key: "owed",
                  align: "right",
                  width: COLUMN.money,
                  render: (_, r) => fmtRp(r.owed),
                },
                {
                  title: t("debtPay.paid", "Paid"),
                  key: "paid",
                  align: "right",
                  width: COLUMN.money,
                  // Empty, not Rp 0, on a row the money does not reach (owner
                  // ask): the column reads as what THIS payment does.
                  render: (_, r) => {
                    const l = lineOf.get(r.key);
                    return l && l.paid > 0 ? (
                      <Typography.Text strong>{fmtRp(l.paid)}</Typography.Text>
                    ) : null;
                  },
                },
              ]}
            />
          </Flex>
        )}
      </Modal>
      <InvoiceModal
        db={viewing ? db : undefined}
        order={viewing ?? undefined}
        open={viewing !== null}
        onClose={() => setViewing(null)}
      />
    </>
  );
}

/** The button every row carries. */
export function RecordPaymentButton({
  onClick,
  label,
}: {
  readonly onClick: () => void;
  readonly label: string;
}) {
  const { t } = useTranslation();
  return (
    <Button size="small" type="primary" onClick={onClick} aria-label={label}>
      {t("debtPay.recordRow", "Record payment")}
    </Button>
  );
}
