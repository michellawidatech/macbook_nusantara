/**
 * Record a DP on a reservation (owner, 2026-10-27, "yes to DP").
 *
 * Staff open this AFTER checking the transfer in the bank (or counting the
 * cash) — the bot never records a DP, it hands the proof over as `Perlu
 * verifikasi DP`. Recording it is what makes the hold firm: in the same
 * mutation the DP payment is written, every unit the hold wants goes
 * `DIRESERVASI` with its ledger row, and `heldUntil` is the DP's moment plus
 * the rule's days (`lib/dp.ts`).
 *
 * Shared by /reservations and the till's "Sell from a reservation" dialog, so
 * the two doors record the same thing.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import {
  App,
  DatePicker,
  Form,
  Input,
  Modal,
  Segmented,
  Typography,
} from "antd";
import { MoneyInput } from "./MoneyInput";
import { fmtDate, fmtRp } from "../lib/format.js";
import { DP_METHODS, dpRule, recordDp, type DpMethod } from "../lib/dp.js";
import { appendEvent, mutate, nextId, useDb } from "../mock/store.js";
import type { Reservation } from "../mock/seed.js";

interface DpForm {
  amount: number;
  method: DpMethod;
  day: dayjs.Dayjs;
  note?: string;
}

export function RecordDpModal({
  reservation,
  customerName,
  onClose,
}: {
  /** The hold to record it on; null keeps the dialog shut. */
  readonly reservation: Reservation | null;
  readonly customerName: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const rule = dpRule(db.settings);
  const [form] = Form.useForm<DpForm>();

  useEffect(() => {
    if (reservation)
      form.setFieldsValue({
        amount: rule.amount,
        method: "TRANSFER",
        day: dayjs(),
        note: "",
      });
  }, [reservation?.id]);

  const methodLabel = (m: DpMethod) =>
    m === "TRANSFER"
      ? t("pos.methodTransfer", "Transfer")
      : t("pos.methodCash", "Cash");

  const save = (v: DpForm) => {
    if (!reservation) return;
    // The day staff picked, at the clock time they recorded it.
    const now = dayjs();
    const at = v.day
      .hour(now.hour())
      .minute(now.minute())
      .second(now.second())
      .toISOString();
    let held: readonly string[] = [];
    let until = "";
    mutate((d) => {
      held = recordDp(
        d,
        reservation.id,
        {
          id: nextId("pay"),
          amount: v.amount,
          method: v.method,
          at,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
        },
        rule,
        appendEvent,
      );
      until =
        d.reservations.find((r) => r.id === reservation.id)?.heldUntil ?? "";
    });
    message.success(
      t(
        "dp.recorded",
        "DP {{amount}} recorded — {{count}} unit(s) held for {{name}} until {{until}}.",
        {
          amount: fmtRp(v.amount),
          count: held.length,
          name: customerName,
          until: until ? fmtDate(until) : "",
        },
      ),
    );
    onClose();
  };

  return (
    <Modal
      open={reservation !== null}
      title={t("dp.recordTitle", "Record DP — {{code}}", {
        code: reservation?.code ?? "",
      })}
      okText={t("dp.recordOk", "Record DP and hold")}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
      width={520}
    >
      <Typography.Paragraph type="secondary">
        {t(
          "dp.recordHint",
          "Check the bank or count the cash first. The units are held for {{days}} days from the DP's date.",
          { days: rule.days },
        )}
      </Typography.Paragraph>
      <Form<DpForm> form={form} layout="vertical" onFinish={save}>
        <Form.Item
          name="amount"
          label={t("dp.amount", "DP amount")}
          rules={[
            {
              required: true,
              type: "number",
              min: 1,
              message: t("dp.amountNeeded", "Type the DP amount."),
            },
          ]}
        >
          <MoneyInput min={1} />
        </Form.Item>
        <Form.Item
          name="method"
          label={t("dp.method", "Paid by")}
          rules={[{ required: true }]}
        >
          <Segmented<DpMethod>
            options={DP_METHODS.map((m) => ({
              value: m,
              label: methodLabel(m),
            }))}
          />
        </Form.Item>
        <Form.Item
          name="day"
          label={t("dp.date", "DP date")}
          rules={[
            {
              required: true,
              message: t("dp.pickDate", "Pick the DP's date."),
            },
          ]}
        >
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="note" label={t("dp.note", "Note")}>
          <Input maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
