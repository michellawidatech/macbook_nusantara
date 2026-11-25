/**
 * Lower one unit's COGS — "Penurunan harga barang" (owner ask 2026-11-24).
 *
 * > *"It might decrease by 500k because it has been broken while they still
 * > store it … this only decreases the modal price and adds it to PnL but not
 * > to transaction."*
 *
 * Records a new write-down, or corrects one (`editing`). Amount, reason and
 * date are required; the date is never after today, because it decides the
 * month Profit & Loss counts the loss in. The amount may not take the COGS
 * below zero, measured against the cost WITHOUT the row being edited.
 * `lib/writeDown.ts` holds the rules; no money moves.
 */
import { useEffect, useState } from "react";
import { App, DatePicker, Flex, Form, Input, Modal, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "./MoneyInput";
import { fmtRp } from "../lib/format.js";
import { costIndex } from "../lib/service.js";
import { writeDownProblem } from "../lib/writeDown.js";
import { currentStaffName, mutate, nextId, useDb } from "../mock/store.js";
import type { Unit, WriteDown } from "../mock/seed.js";
import { FORM_CENTRE, SPACE } from "../theme/tokens";

export interface WriteDownModalProps {
  readonly open: boolean;
  readonly unit: Unit | null;
  /** The row being corrected; absent records a new one. */
  readonly editing?: WriteDown | null;
  readonly onClose: () => void;
}

export function WriteDownModal({
  open,
  unit,
  editing,
  onClose,
}: WriteDownModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(editing?.amount ?? null);
    setReason(editing?.reason ?? "");
    setDate(editing ? dayjs(editing.date) : dayjs());
    setTried(false);
  }, [open, editing?.id]);

  if (unit === null) return null;
  const sku = db.skus.find((k) => k.id === unit.skuId);
  const cost = costIndex(db)(unit);
  /** The COGS with this row taken back out — what the amount comes off. */
  const before = cost.total + (editing?.amount ?? 0);
  const after = before - (amount ?? 0);
  const problem = writeDownProblem(amount, reason, before);

  const save = () => {
    setTried(true);
    if (problem !== undefined) return;
    const now = new Date().toISOString();
    const day = date.format("YYYY-MM-DD");
    mutate((d) => {
      if (editing) {
        const row = d.writeDowns.find((w) => w.id === editing.id);
        if (!row) return;
        row.amount = amount!;
        row.reason = reason.trim();
        row.date = day;
        row.updatedAt = now;
        return;
      }
      d.writeDowns.push({
        id: nextId("wd"),
        serial: unit.serial,
        amount: amount!,
        reason: reason.trim(),
        date: day,
        staff: currentStaffName(),
        createdAt: now,
        updatedAt: now,
      });
    });
    message.success(
      editing
        ? t("writeDown.updated", "Write-down corrected.")
        : t("writeDown.saved", "COGS lowered by {{amount}}.", {
            amount: fmtRp(amount!),
          }),
    );
    onClose();
  };

  const amountError =
    tried && problem === "AMOUNT"
      ? t("writeDown.amountRequired", "Enter how much the value went down.")
      : problem === "BELOW_ZERO"
        ? t(
            "writeDown.belowZero",
            "That is more than the unit's COGS ({{cost}}).",
            { cost: fmtRp(before) },
          )
        : undefined;
  const reasonError =
    tried && problem === "REASON"
      ? t("writeDown.reasonRequired", "Say why the value went down.")
      : undefined;

  const row = (label: string, value: number, strong = false) => (
    <Flex justify="space-between">
      <Typography.Text type={strong ? undefined : "secondary"} strong={strong}>
        {label}
      </Typography.Text>
      <Typography.Text strong={strong}>{fmtRp(value)}</Typography.Text>
    </Flex>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={520}
      // Opened from inside Inventory's nested table and the cost popover —
      // the level `UnitEditModal` sits at, for the same reason.
      zIndex={1100}
      title={
        editing
          ? t("writeDown.editTitle", "Correct the write-down of {{serial}}", {
              serial: unit.serial,
            })
          : t("writeDown.title", "Lower the COGS of {{serial}}", {
              serial: unit.serial,
            })
      }
      okText={t("writeDown.save", "Save")}
      onOk={save}
      destroyOnHidden
    >
      <Form layout="vertical" style={FORM_CENTRE}>
        {sku && (
          <Typography.Paragraph type="secondary">
            {`${sku.name} ${sku.variantLabel}`.trim()}
            {unit.grade ? ` · ${unit.grade}` : ""}
          </Typography.Paragraph>
        )}
        <div style={{ marginBottom: SPACE.md }}>
          {row(t("writeDown.current", "Current COGS"), before)}
        </div>
        <Form.Item
          label={t("writeDown.amount", "Lower by")}
          required
          validateStatus={amountError ? "error" : undefined}
          help={amountError}
        >
          <MoneyInput
            value={amount ?? undefined}
            onChange={setAmount}
            min={0}
            aria-label={t("writeDown.amount", "Lower by")}
          />
        </Form.Item>
        <Form.Item
          label={t("writeDown.reason", "Reason")}
          required
          validateStatus={reasonError ? "error" : undefined}
          help={reasonError}
        >
          <Input
            value={reason}
            aria-label={t("writeDown.reason", "Reason")}
            placeholder={t("writeDown.reasonHint", "Cracked screen")}
            onChange={(e) => setReason(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("writeDown.date", "Date")} required>
          <DatePicker
            value={date}
            allowClear={false}
            format="DD/MM/YYYY"
            disabledDate={(d) => d.isAfter(dayjs(), "day")}
            onChange={(d) => d && setDate(d)}
            style={{ width: "100%" }}
          />
        </Form.Item>
        {row(t("writeDown.newCost", "New COGS"), Math.max(0, after), true)}
      </Form>
    </Modal>
  );
}
