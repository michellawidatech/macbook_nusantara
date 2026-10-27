/**
 * How a bill was paid, in parts — and the one place either desk edits it.
 *
 * ## Three columns, and the fourth figure is arithmetic (owner, 2026-09-23)
 *
 * > *"For payment per transaction, it should only have these columns: Payment
 * > method (Transfer, Cash, Shopee, Tokopedia) | Status (Pending, settled) |
 * > Amount. The owe should automatically be calculated."*
 *
 * What the customer still owes stops being a row somebody types and becomes
 * the bill less what is recorded against it. Two typed figures can disagree;
 * a subtraction cannot. The shortfall is still STORED as a DUE payment —
 * Receivable, the customer balance and the overdue tag all read one — but it
 * is derived on save, the way `Order.settled` is (`lib/salePayments.ts`).
 *
 * The due date is the one thing the shortfall cannot work out for itself, so
 * it is asked for below the table and only while something is owed.
 *
 * The methods are the till's four, and a marketplace row carries the
 * marketplace's own order number beneath it — that is the key a payout is
 * matched on. A row recorded through anything else keeps its own label rather
 * than being rewritten into one of the four: the method is what sorts money
 * into the cash pot or the bank one.
 */
import {
  Button,
  DatePicker,
  Flex,
  Input,
  InputNumber,
  Select,
  Table,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  MinusCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { SettlementFee } from "../lib/marketplace.js";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import {
  TILL_METHODS,
  tillMethod,
  tillMethodOfPayment,
  type TillMethod,
} from "../lib/tillPayments.js";
import {
  enteredPayments,
  owedDueAt,
  withOwed,
  type PaymentState,
  type SalePayment,
} from "../lib/salePayments.js";
import { COLUMN, SPACE, TYPE } from "../theme/tokens";

export interface PaymentsPanelProps {
  /** The sale, so a derived shortfall row is filed under a stable id. */
  readonly orderId: string;
  readonly total: number;
  /** The whole list, derived shortfall included. */
  readonly value: readonly SalePayment[];
  /** The whole list back, with the shortfall rebuilt. */
  readonly onChange: (next: SalePayment[]) => void;
  readonly disabled?: boolean;
  /** Hides the add/remove controls — a read-only view on a closed receipt. */
  readonly readOnly?: boolean;
  /**
   * A marketplace payment's deductions, by payment id (owner ask 2026-10-22:
   * *"add directly deduction on the rightmost … a '−' button … a nested row
   * below the Shopee row to add the name and deduction amount"*). Passed by
   * Edit transaction only; absent, the grid draws no deduction control.
   */
  readonly deductions?: Readonly<Record<string, readonly SettlementFee[]>>;
  readonly onDeductionsChange?: (
    paymentId: string,
    fees: SettlementFee[],
  ) => void;
}

let seq = 0;
const newId = () => `pay-${Date.now()}-${++seq}`;

/** A reservation's DP the sale took (2026-10-27) — fixed here. */
const isDp = (p: SalePayment) => p.reservationId !== undefined;

export function PaymentsPanel({
  orderId,
  total,
  value,
  onChange,
  disabled,
  readOnly,
  deductions,
  onDeductionsChange,
}: PaymentsPanelProps) {
  const withDeductions = onDeductionsChange !== undefined;
  const feesOf = (id: string) => deductions?.[id] ?? [];
  const setFees = (id: string, fees: SettlementFee[]) =>
    onDeductionsChange?.(id, fees);
  const { t } = useTranslation();

  const methodLabel = (m: TillMethod): string =>
    m === "TRANSFER"
      ? t("pos.methodTransfer", "Transfer")
      : m === "TUNAI"
        ? t("pos.methodCash", "Cash")
        : m === "SHOPEE"
          ? "Shopee"
          : "Tokopedia";

  const rows = enteredPayments(value);
  const dueAt = owedDueAt(value);
  const recorded = rows.reduce((n, p) => n + p.amount, 0);
  const owed = Math.max(0, total - recorded);

  /** Rebuild the whole list — entered rows plus whatever is still short. */
  const emit = (next: readonly SalePayment[], date = dueAt) =>
    onChange(withOwed(orderId, total, next, date));

  const set = (id: string, patch: Partial<SalePayment>) =>
    emit(rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const add = () =>
    emit([
      ...rows,
      {
        id: newId(),
        method: "TUNAI",
        // The gap, so the common case — a deposit and then the rest — is one
        // press and no arithmetic.
        amount: owed,
        state: "SETTLED",
        at: new Date().toISOString(),
      },
    ]);

  /** Moving a row onto another method rewrites the pair that identifies it. */
  const pickMethod = (p: SalePayment, key: TillMethod) => {
    const def = tillMethod(key);
    set(p.id, {
      method: def.code,
      channel: def.channel,
      // Only a marketplace can be holding money. Cash in a drawer is either
      // there or it is not.
      state: def.channel === undefined ? "SETTLED" : p.state,
      ...(def.channel === undefined ? { ref: undefined } : {}),
    });
  };

  return (
    <Flex vertical gap={SPACE.sm}>
      <Table<SalePayment>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={false}
        locale={{
          emptyText: t("pay.none", "Nothing recorded against this bill yet."),
        }}
        // The deductions of a marketplace payment, nested under its row.
        {...(withDeductions
          ? {
              expandable: {
                showExpandColumn: false,
                expandedRowKeys: rows
                  .filter(
                    (p) => p.channel !== undefined && feesOf(p.id).length > 0,
                  )
                  .map((p) => p.id),
                expandedRowRender: (p: SalePayment) => {
                  const fees = feesOf(p.id);
                  const kept = fees.reduce((n, f) => n + f.amount, 0);
                  return (
                    <Flex vertical gap={4} style={{ paddingLeft: SPACE.lg }}>
                      {fees.map((f, i) => (
                        <Flex key={f.id} gap={SPACE.sm} align="center">
                          <Typography.Text type="secondary">−</Typography.Text>
                          <Input
                            size="small"
                            value={f.label ?? ""}
                            disabled={disabled || readOnly}
                            placeholder={t(
                              "pay.deductionName",
                              "Deduction, e.g. Komisi",
                            )}
                            aria-label={t(
                              "pay.deductionNameFor",
                              "Deduction name",
                            )}
                            onChange={(e) =>
                              setFees(
                                p.id,
                                fees.map((x, j) =>
                                  j === i ? { ...x, label: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <InputNumber
                            size="small"
                            style={{ width: COLUMN.money }}
                            disabled={disabled || readOnly}
                            precision={0}
                            prefix={RP_SYMBOL}
                            formatter={moneyFormatter}
                            parser={moneyParser}
                            aria-label={t(
                              "pay.deductionAmountFor",
                              "Deduction amount",
                            )}
                            value={f.amount}
                            onChange={(v) =>
                              setFees(
                                p.id,
                                fees.map((x, j) =>
                                  j === i ? { ...x, amount: v ?? 0 } : x,
                                ),
                              )
                            }
                          />
                          <Button
                            type="text"
                            size="small"
                            disabled={disabled || readOnly}
                            icon={<DeleteOutlined />}
                            aria-label={t(
                              "pay.removeDeduction",
                              "Remove deduction",
                            )}
                            onClick={() =>
                              setFees(
                                p.id,
                                fees.filter((_, j) => j !== i),
                              )
                            }
                          />
                        </Flex>
                      ))}
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t(
                          "pay.payoutLands",
                          "{{amount}} − {{kept}} deducted = {{received}} received",
                          {
                            amount: fmtRp(p.amount),
                            kept: fmtRp(kept),
                            received: fmtRp(p.amount - kept),
                          },
                        )}
                      </Typography.Text>
                    </Flex>
                  );
                },
              },
            }
          : {})}
        columns={[
          {
            title: t("pay.method", "Payment method"),
            key: "method",
            width: COLUMN.choice + 120,
            render: (_, p) => {
              const key = tillMethodOfPayment(p);
              const options = TILL_METHODS.map((m) => ({
                value: m.key,
                label: methodLabel(m.key),
              }));
              // One line: the method, and — for a marketplace — its order
              // number beside it (owner ask 2026-10-22), not a second row.
              return (
                <Flex gap={4}>
                  <Select<string>
                    size="small"
                    style={{
                      width: p.channel !== undefined ? 120 : "100%",
                      flex: "none",
                    }}
                    // A reservation's DP (2026-10-27) is the reservation's
                    // money: corrected on /reservations, never here.
                    disabled={disabled || readOnly || isDp(p)}
                    value={key ?? p.method}
                    aria-label={t("pay.methodFor", "How it was paid")}
                    options={
                      key === undefined
                        ? [...options, { value: p.method, label: p.method }]
                        : options
                    }
                    onChange={(v) => pickMethod(p, v as TillMethod)}
                  />
                  {/* The marketplace's own order number — what a payout report
                      names this money by, so it is what a report matches on. */}
                  {p.channel !== undefined && (
                    <Input
                      size="small"
                      style={{ flex: 1, minWidth: 0 }}
                      disabled={disabled || readOnly}
                      value={p.ref ?? ""}
                      aria-label={t("pay.refFor", "Reference number")}
                      placeholder={t("pay.refPlaceholder", "Reference number")}
                      onChange={(e) => set(p.id, { ref: e.target.value })}
                    />
                  )}
                </Flex>
              );
            },
          },
          {
            title: t("pay.status", "Status"),
            key: "status",
            width: COLUMN.choice,
            render: (_, p) => {
              const marketplace = p.channel !== undefined;
              return (
                <Select<PaymentState>
                  size="small"
                  style={{ width: "100%" }}
                  disabled={disabled || readOnly || !marketplace}
                  value={p.state === "DUE" ? "SETTLED" : p.state}
                  aria-label={t("pay.stateFor", "State of this payment")}
                  options={[
                    { value: "SETTLED", label: t("pay.settled", "Settled") },
                    ...(marketplace
                      ? [
                          {
                            value: "PENDING" as PaymentState,
                            label: t("pay.pending", "Pending"),
                          },
                        ]
                      : []),
                  ]}
                  // Settling is the payout landing: dated now, which is the
                  // day it reaches the bank's balance.
                  onChange={(v) =>
                    set(p.id, {
                      state: v,
                      ...(v === "SETTLED" && p.state === "PENDING"
                        ? { at: new Date().toISOString() }
                        : {}),
                    })
                  }
                />
              );
            },
          },
          {
            title: t("pay.amount", "Amount"),
            key: "amount",
            width: COLUMN.money,
            align: "right",
            render: (_, p) => (
              <InputNumber
                size="small"
                style={{ width: "100%" }}
                disabled={disabled || readOnly || isDp(p)}
                min={0}
                precision={0}
                prefix={RP_SYMBOL}
                formatter={moneyFormatter}
                parser={moneyParser}
                aria-label={t("pay.amountFor", "Amount")}
                value={p.amount}
                onChange={(v) => set(p.id, { amount: v ?? 0 })}
              />
            ),
          },
          ...(readOnly
            ? []
            : [
                {
                  title: "",
                  key: "remove",
                  width: withDeductions ? COLUMN.actions : COLUMN.action,
                  render: (_: unknown, p: SalePayment) => (
                    <Flex gap={2}>
                      {withDeductions && p.channel !== undefined && (
                        <Button
                          type="text"
                          disabled={disabled}
                          icon={<MinusCircleOutlined />}
                          aria-label={t("pay.addDeduction", "Add a deduction")}
                          title={t("pay.addDeduction", "Add a deduction")}
                          onClick={() =>
                            setFees(p.id, [
                              ...feesOf(p.id),
                              {
                                id: `fee-${Date.now()}-${++seq}`,
                                kind: "OTHER",
                                amount: 0,
                              },
                            ])
                          }
                        />
                      )}
                      <Button
                        type="text"
                        disabled={disabled || isDp(p)}
                        icon={<DeleteOutlined />}
                        aria-label={t("pay.remove", "Remove this payment")}
                        onClick={() => emit(rows.filter((x) => x.id !== p.id))}
                      />
                    </Flex>
                  ),
                },
              ]),
        ]}
      />

      <Flex justify="space-between" align="center" wrap gap={SPACE.sm}>
        {!readOnly && (
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={disabled}
            onClick={add}
          >
            {t("pay.add", "Add a payment")}
          </Button>
        )}
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t("pay.received", "Recorded {{amount}} of {{total}}", {
            amount: fmtRp(recorded),
            total: fmtRp(total),
          })}
        </Typography.Text>
      </Flex>

      {/* The shortfall, and the one thing about it nobody can derive. */}
      {owed > 0 && (
        <Flex align="center" wrap gap={SPACE.md}>
          <Typography.Text type="danger" strong>
            {t("pay.owed", "Customer owes {{amount}}", { amount: fmtRp(owed) })}
          </Typography.Text>
          <DatePicker
            size="small"
            disabled={disabled || readOnly}
            value={dueAt ? dayjs(dueAt) : null}
            aria-label={t("pay.dueFor", "When it is promised")}
            placeholder={t("pay.dueDate", "Due date")}
            onChange={(d) => emit(rows, d ? d.toISOString() : undefined)}
          />
        </Flex>
      )}
    </Flex>
  );
}
