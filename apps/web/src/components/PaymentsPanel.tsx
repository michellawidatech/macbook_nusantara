/**
 * How a bill was paid, in parts — and the one place either desk edits it.
 *
 * Two screens ask the same question of a sale and have to give the same
 * answer: the till, where the money is first recorded, and Transaction
 * History, where it is corrected afterwards (*"we should also be able to edit
 * how much the user have paid, for error handling"*). One panel, so a split
 * entered at the counter reads back the same way a week later.
 *
 * ## What a row says, and why it needs three states
 *
 * SETTLED / PENDING / DUE are not degrees of the same thing — see
 * `lib/salePayments.ts`. Cash in the till, money Shopee is holding, and money
 * a customer has promised are three different facts, and the shop chases a
 * different party for each. The state picker is therefore the first control on
 * a row, and picking PENDING asks which marketplace while picking DUE asks for
 * a date.
 *
 * ## Nothing is written until the caller saves
 *
 * The panel holds a draft and reports it upward. A payment grid that committed
 * per keystroke would file Rp5, Rp50, Rp500 … on the way to Rp5.000.000, and
 * the whole reason edits are logged is that the wrong one of those is what
 * somebody has to find later.
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
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import { SALE_CHANNELS } from "../lib/channels.js";
import {
  saleBalance,
  type PaymentState,
  type SalePayment,
} from "../lib/salePayments.js";
import { SPACE, TYPE } from "../theme/tokens";

export interface PaymentsPanelProps {
  readonly total: number;
  readonly value: readonly SalePayment[];
  readonly onChange: (next: SalePayment[]) => void;
  /**
   * Methods the till offers: a `PaymentMethod` CODE and the label to show.
   *
   * Both, since 2026-09-09. It was a flat list of labels, so a payment
   * recorded here stored "Bank transfer" in a field the schema, the fixture
   * and every other reader treat as a code — and the cash-and-bank balance
   * sorts a movement by exactly that field, so a renamed method quietly
   * belonged to neither pot.
   */
  readonly methods: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly disabled?: boolean;
  /** Hides the add/remove controls — a read-only view on a closed receipt. */
  readonly readOnly?: boolean;
}

let seq = 0;
const newId = () => `pay-${Date.now()}-${++seq}`;

export function PaymentsPanel({
  total,
  value,
  onChange,
  methods,
  disabled,
  readOnly,
}: PaymentsPanelProps) {
  const { t } = useTranslation();
  const balance = saleBalance(total, value);

  const set = (id: string, patch: Partial<SalePayment>) =>
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const add = () =>
    onChange([
      ...value,
      {
        id: newId(),
        method: methods[0]?.value ?? "TUNAI",
        // The gap, so the common case — a deposit and then the rest — is one
        // press and no arithmetic. Zero when the bill is already accounted
        // for, which is the honest starting point for a correction.
        amount: balance.unaccounted,
        state: "SETTLED",
        at: new Date().toISOString(),
      },
    ]);

  const states: { value: PaymentState; label: string }[] = [
    { value: "SETTLED", label: t("pay.settled", "Received") },
    { value: "PENDING", label: t("pay.pending", "With a marketplace") },
    { value: "DUE", label: t("pay.due", "Owed by the customer") },
  ];

  return (
    <Flex vertical gap={SPACE.sm}>
      <Table<SalePayment>
        size="small"
        rowKey="id"
        dataSource={value as SalePayment[]}
        pagination={false}
        locale={{
          emptyText: t("pay.none", "Nothing recorded against this bill yet."),
        }}
        columns={[
          {
            title: t("pay.state", "State"),
            key: "state",
            width: 190,
            render: (_, p) => (
              <Select
                size="small"
                style={{ width: "100%" }}
                disabled={disabled || readOnly}
                value={p.state}
                options={states}
                aria-label={t("pay.stateFor", "State of this payment")}
                onChange={(v: PaymentState) =>
                  set(p.id, {
                    state: v,
                    // A state change clears what the other states meant. A
                    // date on a settled payment or a channel on a debt are
                    // both fields nobody can act on.
                    channel:
                      v === "PENDING" ? (p.channel ?? "SHOPEE") : undefined,
                    dueAt: v === "DUE" ? p.dueAt : undefined,
                  })
                }
              />
            ),
          },
          {
            title: t("pay.method", "Method"),
            key: "method",
            width: 170,
            render: (_, p) =>
              p.state === "PENDING" ? (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  disabled={disabled || readOnly}
                  value={p.channel}
                  aria-label={t("pay.channelFor", "Marketplace holding it")}
                  options={SALE_CHANNELS.filter((c) => c.holdsFunds).map(
                    (c) => ({ value: c.value, label: c.label }),
                  )}
                  onChange={(v: string) => set(p.id, { channel: v })}
                />
              ) : (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  disabled={disabled || readOnly}
                  value={p.method}
                  aria-label={t("pay.methodFor", "How it was paid")}
                  options={methods as { value: string; label: string }[]}
                  onChange={(v: string) => set(p.id, { method: v })}
                />
              ),
          },
          {
            title: t("pay.amount", "Amount"),
            key: "amount",
            width: 170,
            align: "right",
            render: (_, p) => (
              <InputNumber
                size="small"
                style={{ width: "100%" }}
                disabled={disabled || readOnly}
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
          {
            title: t("pay.dueDate", "Due"),
            key: "due",
            width: 150,
            render: (_, p) =>
              p.state === "DUE" ? (
                <DatePicker
                  size="small"
                  style={{ width: "100%" }}
                  disabled={disabled || readOnly}
                  value={p.dueAt ? dayjs(p.dueAt) : null}
                  aria-label={t("pay.dueFor", "When it is promised")}
                  onChange={(d) =>
                    set(p.id, { dueAt: d ? d.toISOString() : undefined })
                  }
                />
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: t("pay.note", "Note"),
            key: "note",
            render: (_, p) => (
              <Input
                size="small"
                disabled={disabled || readOnly}
                placeholder={t("pay.notePlaceholder", "DP, sisa, …")}
                aria-label={t("pay.noteFor", "Note")}
                value={p.note ?? ""}
                onChange={(e) => set(p.id, { note: e.target.value })}
              />
            ),
          },
          ...(readOnly
            ? []
            : [
                {
                  title: "",
                  key: "remove",
                  width: 44,
                  render: (_: unknown, p: SalePayment) => (
                    <Button
                      type="text"
                      disabled={disabled}
                      icon={<DeleteOutlined />}
                      aria-label={t("pay.remove", "Remove this payment")}
                      onClick={() =>
                        onChange(value.filter((x) => x.id !== p.id))
                      }
                    />
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
        <Flex gap={SPACE.md} wrap>
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t("pay.received", "Received {{amount}}", {
              amount: fmtRp(balance.settled),
            })}
          </Typography.Text>
          {balance.pending > 0 && (
            <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
              {t("pay.pendingAmount", "With a marketplace {{amount}}", {
                amount: fmtRp(balance.pending),
              })}
            </Typography.Text>
          )}
          {balance.customerOwes > 0 && (
            <Typography.Text type="danger" style={{ fontSize: TYPE.sm }}>
              {t("pay.owed", "Customer owes {{amount}}", {
                amount: fmtRp(balance.customerOwes),
              })}
            </Typography.Text>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}
