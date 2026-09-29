/**
 * Turning a marketplace payout into money, and saying what the platform kept.
 *
 * > *"It will have fixed fee from the marketplace … then often times there're
 * > additional adjustment like bank transfer fee. But the existing system
 * > don't keep track of which fee is which and what the adjustment is for."*
 * > — owner, 2026-09-08
 *
 * > *"When clicked, it will show a table of 'deduction' (free-text input) and
 * > amount, which will automatically reduce the amount received."*
 * > — owner, 2026-09-20
 *
 * > *"The payment pending is not always deducted as 10%, the user should be
 * > the one adding the deduction."* — owner, 2026-09-20, later the same day
 *
 * So this dialog is a table and nothing else: what was deducted, in the words
 * off the statement, and how much. Three things it no longer does, each
 * removed by that second ask:
 *
 * 1. **It seeds nothing.** It used to open with a commission line computed
 *    from the shop's rate for the channel. Shopee, Tokopedia and a campaign
 *    month do not agree on a percentage, and a figure the form invents is a
 *    figure somebody has to check before they can trust the one under it.
 * 2. **There is no "amount received" box.** What landed is `gross − Σ
 *    deductions`, full stop; it is shown on the row in the table behind this
 *    dialog, where it can be read beside the amount it came from.
 * 3. **No discrepancy, and therefore no reason.** Those existed because the
 *    received figure could be typed over the arithmetic. With the deductions
 *    as the only input the two can never disagree — a payout that came up
 *    short is a deduction nobody has named yet, which is a row in this table.
 *
 * `FeeKind` survives in the data underneath (every line typed here is
 * `OTHER`), because that is what `Settlement.fees` stores and what the
 * schema's enum holds; `label` is the sentence.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Flex,
  Input,
  InputNumber,
  Modal,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import { channelOf } from "../lib/channels.js";
import { settlementTotals, type SettlementFee } from "../lib/marketplace.js";
import { COLUMN, SPACE } from "../theme/tokens";

export interface SettleModalProps {
  readonly open: boolean;
  /** What is being received — a channel, and one sale's payment. */
  readonly channel: string;
  readonly gross: number;
  /** Which sale this payout is for, for the line under the title. */
  readonly subject?: string;
  /** Prefilled when an existing settlement is being corrected. */
  readonly existing?: {
    readonly fees: readonly SettlementFee[];
  };
  readonly onClose: () => void;
  readonly onSave: (result: {
    readonly fees: SettlementFee[];
    /** `gross` less the deductions. Derived here so one place computes it. */
    readonly received: number;
  }) => void;
}

let seq = 0;
const newId = () => `fee-${Date.now()}-${++seq}`;

export function SettleModal({
  open,
  channel,
  gross,
  subject,
  existing,
  onClose,
  onSave,
}: SettleModalProps) {
  const { t } = useTranslation();
  const [fees, setFees] = useState<SettlementFee[]>([]);

  const label = channelOf(channel)?.label ?? channel;

  useEffect(() => {
    if (!open) return;
    setFees(existing ? existing.fees.map((f) => ({ ...f })) : []);
    // Re-seeded when the dialog opens on a different payout, not when
    // `existing` changes identity under a store write. This project's eslint
    // config has no exhaustive-deps rule to disable, so the reason is stated
    // rather than suppressed.
  }, [open, channel, gross]);

  const totals = settlementTotals({ gross, fees });

  const set = (id: string, patch: Partial<SettlementFee>) =>
    setFees((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={640}
      // A correction says it is one: the money has already been received,
      // and "Mark as received" on a payout recorded last week reads as doing
      // it twice.
      title={
        existing === undefined
          ? t("settle.title", "Receive from {{channel}}", { channel: label })
          : t("settle.amendTitle", "Correct the withdrawal from {{channel}}", {
              channel: label,
            })
      }
      okText={
        existing === undefined
          ? t("settle.mark", "Mark as received")
          : t("settle.saveCorrection", "Save the correction")
      }
      onOk={() => onSave({ fees, received: totals.expected })}
    >
      <Flex vertical gap={SPACE.md}>
        <Typography.Text type="secondary">
          {subject === undefined
            ? t("settle.coveringPlain", "{{gross}} waiting at {{channel}}.", {
                gross: fmtRp(gross),
                channel: label,
              })
            : t("settle.covering", "{{subject}} · {{gross}}", {
                subject,
                gross: fmtRp(gross),
              })}
        </Typography.Text>

        <Table<SettlementFee>
          size="small"
          rowKey="id"
          dataSource={fees}
          pagination={false}
          locale={{
            emptyText: t(
              "settle.noFees",
              "No deductions. The whole amount landed.",
            ),
          }}
          columns={[
            {
              title: t("settle.feeLabel", "Deduction"),
              key: "label",
              render: (_, f) => (
                <Input
                  size="small"
                  value={f.label ?? ""}
                  aria-label={t("settle.feeLabelFor", "What was deducted")}
                  placeholder={t(
                    "settle.feeLabelPlaceholder",
                    "As the statement calls it",
                  )}
                  onChange={(e) => set(f.id, { label: e.target.value })}
                />
              ),
            },
            {
              title: t("settle.feeAmount", "Amount"),
              key: "amount",
              width: COLUMN.money,
              align: "right",
              render: (_, f) => (
                <InputNumber
                  size="small"
                  style={{ width: "100%" }}
                  // A deduction stops at zero, which is what keeps a mistyped
                  // minus from inflating what the shop is owed. The one line
                  // already below it is the Shopee upload's Pembayaran
                  // Tambahan — money ADDED to the payout — and a `min` of 0
                  // would clamp it on the first blur, rewriting what landed
                  // without anybody touching the figure.
                  min={f.amount < 0 ? undefined : 0}
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
              width: COLUMN.action,
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
            setFees((f) => [
              ...f,
              { id: newId(), kind: "OTHER", label: "", amount: 0 },
            ])
          }
        >
          {t("settle.addFee", "Add a deduction")}
        </Button>
      </Flex>
    </Modal>
  );
}
