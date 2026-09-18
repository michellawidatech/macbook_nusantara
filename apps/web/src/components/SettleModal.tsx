/**
 * Turning a marketplace payout into money, and saying what the platform kept.
 *
 * > *"It will have fixed fee from the marketplace (let's say 10%), then often
 * > times there're additional adjustment like bank transfer fee. But the
 * > existing system don't keep track of which fee is which and what the
 * > adjustment is for … mark as done (enter the fee and additional fee,
 * > auto-calculate the amount of money they get but can be overwritten, and
 * > the discrepancies is highlighted and staff can add reason."*
 * > — owner, 2026-09-08
 *
 * The arithmetic and its reasoning are in `lib/marketplace.ts`; this is the
 * form. Three things it is careful about:
 *
 * 1. **It opens already filled in.** The commission line is seeded from the
 *    shop's rate for the channel and the received box starts at the
 *    expectation, so a payout that behaves normally is one press. The fees
 *    that *"often times"* appear are added, not deleted.
 * 2. **The received figure is the truth.** It is what a bank statement says,
 *    and a prediction that disagrees with a statement is wrong by definition.
 *    Everything downstream believes this number.
 * 3. **A discrepancy is not absorbed.** When the two disagree the difference
 *    is shown in red or green and a reason is required — pre-filled with the
 *    owner's default so the common case is still one press, but present, so
 *    the shop can answer "why did this payout come up short?" a month later.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Flex,
  Input,
  InputNumber,
  Modal,
  Select,
  Statistic,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import { channelOf } from "../lib/channels.js";
import {
  DEFAULT_DISCREPANCY_REASON,
  FEE_KINDS,
  seedFees,
  settlementTotals,
  type FeeKind,
  type SettlementFee,
} from "../lib/marketplace.js";
import { SPACE, TYPE } from "../theme/tokens";

export interface SettleModalProps {
  readonly open: boolean;
  /** What is being settled — a channel and the sales behind it. */
  readonly channel: string;
  readonly gross: number;
  /** How many sales this payout covers, for the subtitle. */
  readonly count: number;
  readonly rates: Readonly<Record<string, number>> | undefined;
  /** Prefilled when an existing settlement is being amended. */
  readonly existing?: {
    readonly fees: readonly SettlementFee[];
    readonly received: number;
    readonly reason?: string;
  };
  readonly onClose: () => void;
  readonly onSave: (result: {
    readonly fees: SettlementFee[];
    readonly received: number;
    readonly reason?: string;
  }) => void;
}

let seq = 0;
const newId = () => `fee-${Date.now()}-${++seq}`;

export function SettleModal({
  open,
  channel,
  gross,
  count,
  rates,
  existing,
  onClose,
  onSave,
}: SettleModalProps) {
  const { t } = useTranslation();
  const [fees, setFees] = useState<SettlementFee[]>([]);
  const [received, setReceived] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    const seeded = existing
      ? existing.fees.map((f) => ({ ...f }))
      : seedFees(gross, channel, rates, newId());
    setFees(seeded);
    setReceived(
      existing
        ? existing.received
        : settlementTotals({ gross, fees: seeded }).expected,
    );
    setReason(existing?.reason ?? "");
    // Re-seeded when the dialog opens on a different payout, not when
    // `existing` changes identity under a store write. This project's eslint
    // config has no exhaustive-deps rule to disable, so the reason is stated
    // rather than suppressed.
  }, [open, channel, gross]);

  const totals = settlementTotals({
    gross,
    fees,
    ...(received === null ? {} : { received }),
  });

  const set = (id: string, patch: Partial<SettlementFee>) =>
    setFees((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const label = channelOf(channel)?.label ?? channel;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={760}
      title={t("settle.title", "Withdraw from {{channel}}", { channel: label })}
      okText={t("settle.mark", "Mark as received")}
      okButtonProps={{
        disabled: totals.needsReason && reason.trim() === "",
      }}
      onOk={() =>
        onSave({
          fees,
          received: totals.received,
          ...(totals.needsReason ? { reason: reason.trim() } : {}),
        })
      }
    >
      <Flex vertical gap={SPACE.md}>
        <Typography.Text type="secondary">
          {t("settle.covering", "{{count}} sale(s), {{gross}} in total.", {
            count,
            gross: fmtRp(gross),
          })}
        </Typography.Text>

        <Table<SettlementFee>
          size="small"
          rowKey="id"
          dataSource={fees}
          pagination={false}
          locale={{
            emptyText: t("settle.noFees", "No deductions recorded."),
          }}
          columns={[
            {
              title: t("settle.feeKind", "What was deducted"),
              key: "kind",
              width: 230,
              render: (_, f) => (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={f.kind}
                  aria-label={t("settle.feeKindFor", "Kind of deduction")}
                  options={FEE_KINDS.map((k) => ({
                    value: k.value,
                    label: k.label,
                    title: k.guide,
                  }))}
                  onChange={(v: FeeKind) => set(f.id, { kind: v })}
                />
              ),
            },
            {
              title: t("settle.feeLabel", "As the statement calls it"),
              key: "label",
              render: (_, f) => (
                <Input
                  size="small"
                  value={f.label ?? ""}
                  aria-label={t("settle.feeLabelFor", "Name on the statement")}
                  placeholder={t("settle.feeLabelPlaceholder", "Optional")}
                  onChange={(e) => set(f.id, { label: e.target.value })}
                />
              ),
            },
            {
              title: t("settle.feeAmount", "Amount"),
              key: "amount",
              width: 170,
              align: "right",
              render: (_, f) => (
                <InputNumber
                  size="small"
                  style={{ width: "100%" }}
                  min={0}
                  precision={0}
                  prefix={RP_SYMBOL}
                  formatter={moneyFormatter}
                  parser={moneyParser}
                  aria-label={t("settle.feeAmountFor", "Amount deducted")}
                  value={f.amount}
                  onChange={(v) => set(f.id, { amount: v ?? 0 })}
                />
              ),
            },
            {
              title: "",
              key: "remove",
              width: 44,
              render: (_, f) => (
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={t("settle.removeFee", "Remove this deduction")}
                  onClick={() => setFees((x) => x.filter((y) => y.id !== f.id))}
                />
              ),
            },
          ]}
        />

        <Button
          size="small"
          icon={<PlusOutlined />}
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            setFees((f) => [...f, { id: newId(), kind: "TRANSFER", amount: 0 }])
          }
        >
          {t("settle.addFee", "Add a deduction")}
        </Button>

        <Flex gap={SPACE.lg} wrap>
          <Statistic
            title={t("settle.expected", "Should land")}
            value={fmtRp(totals.expected)}
          />
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary">
              {t("settle.received", "Actually landed")}
            </Typography.Text>
            <InputNumber
              min={0}
              precision={0}
              prefix={RP_SYMBOL}
              formatter={moneyFormatter}
              parser={moneyParser}
              style={{ width: 200 }}
              aria-label={t("settle.receivedFor", "What actually landed")}
              value={received}
              onChange={setReceived}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("settle.receivedHint", "What the bank statement says.")}
            </Typography.Text>
          </Flex>
        </Flex>

        {totals.needsReason && (
          <Alert
            type={totals.discrepancy < 0 ? "error" : "warning"}
            showIcon
            message={
              totals.discrepancy < 0
                ? t(
                    "settle.short",
                    "{{amount}} less arrived than the fees explain.",
                    {
                      amount: fmtRp(-totals.discrepancy),
                    },
                  )
                : t(
                    "settle.over",
                    "{{amount}} more arrived than the fees explain.",
                    {
                      amount: fmtRp(totals.discrepancy),
                    },
                  )
            }
            description={
              <Flex vertical gap={SPACE.xs} style={{ marginTop: SPACE.xs }}>
                <Input
                  value={reason}
                  aria-label={t("settle.reasonFor", "Why the figures differ")}
                  placeholder={DEFAULT_DISCREPANCY_REASON}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  size="small"
                  type="link"
                  style={{ alignSelf: "flex-start", paddingInline: 0 }}
                  onClick={() => setReason(DEFAULT_DISCREPANCY_REASON)}
                >
                  {t("settle.useDefault", "Use “{{reason}}”", {
                    reason: DEFAULT_DISCREPANCY_REASON,
                  })}
                </Button>
              </Flex>
            }
          />
        )}
      </Flex>
    </Modal>
  );
}
