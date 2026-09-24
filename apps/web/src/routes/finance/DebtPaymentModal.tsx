/**
 * Recording one payment against a supplier's or a customer's debts — the
 * dialog behind *Add payment* and every row's *Record payment* on Payable and
 * Receivable (owner ask 2026-09-22).
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
import { accountOfMethod } from "../../lib/accounts.js";
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
import { currentStaffName, mutate, nextId, useDb } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { SPACE, TYPE } from "../../theme/tokens";

export type DebtSide = "PAYABLE" | "RECEIVABLE";

/** Where the dialog opens: a party, and optionally the one row to tick. */
export interface DebtPaymentTarget {
  readonly partyId: string;
  readonly rowKey?: string;
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
}

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
        ? payableGroups(db.pos, db.suppliers).map((g) => ({
            id: g.supplierId,
            name: g.supplierName || t("utang.noSupplier", "No supplier named"),
            phone: "",
            owed: g.owed,
            docs: g.rows.map<Doc>((r) => ({
              key: r.key,
              code: r.code,
              at: r.at,
              owed: r.owed,
              opening: r.opening,
            })),
          }))
        : receivableGroups(db.orders, db.customers, walkIn).map((g) => ({
            id: g.customerId,
            name: g.customerName,
            phone: g.phone,
            owed: g.owed,
            // Oldest first, whatever order the call list keeps.
            docs: g.rows.map<Doc>((r) => ({
              key: r.key,
              code: r.code,
              at: r.at,
              owed: r.owed,
              opening: r.opening,
            })),
          })),
    [payable, db.pos, db.suppliers, db.orders, db.customers, walkIn, t],
  );

  const [partyId, setPartyId] = useState("");
  const [alloc, setAlloc] = useState<AllocationState>(EMPTY_ALLOCATION);
  const [method, setMethod] = useState("TRANSFER");
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [inBalance, setInBalance] = useState(true);
  const [note, setNote] = useState("");
  /** The sale a transaction number opened, over this dialog. */
  const [viewing, setViewing] = useState<Order | null>(null);

  // Re-seeded when the dialog opens, not whenever the store moves — a poll
  // from another till must not wipe what somebody is typing.
  useEffect(() => {
    if (!target) return;
    setPartyId(target.partyId);
    setAlloc(
      target.rowKey
        ? { ...EMPTY_ALLOCATION, picked: [target.rowKey] }
        : EMPTY_ALLOCATION,
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
   * strangers' bills: opened from a walk-in row, the dialog offers that row.
   */
  const docs = useMemo<readonly Doc[]>(() => {
    const all = group?.docs ?? [];
    if (partyId === WALK_IN && target?.rowKey)
      return all.filter((d) => d.key === target.rowKey);
    return all;
  }, [group, partyId, target]);

  const result = allocate(docs, alloc);
  const lineOf = new Map(result.lines.map((l) => [l.key, l]));
  const partyOwed = docs.reduce((n, d) => n + d.owed, 0);
  /** A supplier's remainder is a deposit; `po:` groups have no supplier to hold one. */
  const canDeposit = payable && partyId !== "" && !partyId.startsWith("po:");
  const overpaid = result.leftover > 0;
  const refused = overpaid && !canDeposit;

  const methods = db.paymentMethods
    .filter((m) => m.active && (payable ? m.forPo : m.forSale))
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
          const party = payable
            ? d.suppliers.find((s) => s.id === partyId)
            : d.customers.find((c) => c.id === partyId);
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
                onChange={(v: string) => {
                  setPartyId(v);
                  setAlloc(EMPTY_ALLOCATION);
                }}
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
          </Flex>
          <Flex gap={SPACE.md} wrap>
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
                  width: 170,
                  render: (_, r) => fmtRp(r.owed),
                },
                {
                  title: t("debtPay.paid", "Paid"),
                  key: "paid",
                  align: "right",
                  width: 170,
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
    <Button size="small" onClick={onClick} aria-label={label}>
      {t("debtPay.recordRow", "Record payment")}
    </Button>
  );
}
