/**
 * Record a charge on a service visit, or correct one (lifted out of the Service
 * page on 2026-11-04 so Inbound's *Back from service* tab can open it too).
 * The writes are the Service page's own: a `ServiceFee` on the visit, its
 * `UNIT` expense when paid, and a line on the unit's timeline.
 */
import { useEffect } from "react";
import { App, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { PaidWithField } from "./SendToServiceModal";
import { fmtRp } from "../lib/format.js";
import {
  SERVICE_FEE_KINDS,
  editFee,
  type ServiceFee,
  type ServiceFeeKind,
} from "../lib/service.js";
import {
  chargeExpense,
  feePayment,
  localDay,
  type PaidWith,
} from "../lib/serviceActions.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../mock/store.js";

/** Which visit, which unit, and — when correcting — which charge. */
export interface ChargeTarget {
  readonly visitId: string;
  readonly serial: string;
  readonly fee?: ServiceFee;
}

export function ServiceChargeModal({
  target,
  onClose,
}: {
  readonly target: ChargeTarget | null;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [feeForm] = Form.useForm<{
    kind: ServiceFeeKind;
    label?: string;
    amount: number;
    paidWith?: PaidWith;
  }>();

  // What the form opens on: a new charge, or the one being corrected.
  useEffect(() => {
    if (!target) return;
    if (!target.fee) {
      feeForm.setFieldsValue({ kind: "LABOUR", paidWith: "UNPAID" });
      return;
    }
    const pay = feePayment(target.fee, db.expenses);
    feeForm.setFieldsValue({
      kind: target.fee.kind,
      label: target.fee.label ?? "",
      amount: target.fee.amount,
      paidWith: pay.expense
        ? (pay.expense.method as PaidWith)
        : pay.paid
          ? undefined
          : "UNPAID",
    });
  }, [target?.visitId, target?.fee?.id]);

  /**
   * Record a charge, or correct one already recorded.
   *
   * One handler for both because they are one form. What differs is only
   * whether an id already exists: `editFee` rewrites that row, and a new
   * charge is appended. Either way the unit's own timeline gets a line —
   * somebody chasing a serial should not have to know this screen exists to
   * find out what it cost. A new charge's line carries the charge's own
   * instant, which is how deleting the charge finds it again.
   *
   * Paid with: a charge paid now writes its UNIT expense in the same
   * mutation. Correcting a paid charge's amount moves its expense with it —
   * here when this browser holds the expense, and on the server either way
   * (the charge owns its expense; an account without finance access is sent
   * none). Switching a paid charge to *Not paid yet* removes the expense, and
   * is offered only where the expense can be seen.
   */
  const saveFee = () =>
    feeForm.validateFields().then((v) => {
      if (!target) return;
      const row = { rec: { id: target.visitId }, serial: target.serial };
      const before = target.fee;
      const at = new Date().toISOString();
      void mutate((d) => {
        const i = d.services.findIndex((r) => r.id === row.rec.id);
        if (i < 0) return;
        // Replaced rather than mutated in place: `ServiceRec` is a readonly
        // shape, the same discipline `Order.payments` follows, and the store
        // is replace-on-write anyway.
        const rec = d.services[i]!;
        const feeId = before?.id ?? nextId("svcf");
        const paidWith = v.paidWith;
        const existing = d.expenses.find((e) => e.serviceFeeId === feeId);
        const paidNow =
          paidWith !== undefined &&
          paidWith !== "UNPAID" &&
          !existing &&
          !(before?.paid === true);
        let next = before
          ? editFee(rec, before.id, {
              kind: v.kind,
              label: v.label ?? "",
              amount: v.amount,
            })
          : {
              ...rec,
              fees: [
                ...rec.fees,
                {
                  id: feeId,
                  kind: v.kind,
                  ...(v.label ? { label: v.label } : {}),
                  amount: v.amount,
                  at,
                  staff: currentStaffName(),
                },
              ],
            };
        const fee = next.fees.find((f) => f.id === feeId)!;
        if (paidNow) {
          d.expenses.unshift(
            chargeExpense({
              id: nextId("exp"),
              serial: row.serial,
              fee,
              method: paidWith,
              day: localDay(at),
              createdAt: at,
            }),
          );
        } else if (existing) {
          if (paidWith === "UNPAID") {
            d.expenses = d.expenses.filter((e) => e.id !== existing.id);
          } else {
            existing.amount = fee.amount;
            if (paidWith !== undefined) existing.method = paidWith;
          }
        }
        const paid =
          paidNow || (existing !== undefined && paidWith !== "UNPAID")
            ? true
            : existing !== undefined
              ? false
              : before?.paid === true;
        next = {
          ...next,
          fees: next.fees.map((f) => {
            if (f.id !== feeId) return f;
            const { paid: _was, ...rest } = f;
            return paid ? { ...rest, paid: true as const } : rest;
          }),
        };
        d.services[i] = next;
        appendEvent(d, row.serial, {
          type: "DICATAT",
          ...(before ? {} : { at }),
          note: before
            ? // Both figures, because the point of allowing the correction is
              // that somebody has to be able to see what it replaced.
              `Service charge corrected ${fmtRp(before.amount)} → ${fmtRp(
                v.amount,
              )} — ${v.label || v.kind}`
            : `Service charge ${fmtRp(v.amount)} — ${v.label || v.kind}`,
        });
      });
      onClose();
      feeForm.resetFields();
      message.success(
        before
          ? t("service.feeEdited", "{{serial}}'s charge is now {{amount}}.", {
              amount: fmtRp(v.amount),
              serial: row.serial,
            })
          : t("service.feeAdded", "{{amount}} recorded against {{serial}}.", {
              amount: fmtRp(v.amount),
              serial: row.serial,
            }),
      );
    });

  /** Is the charge being edited paid by an expense this browser cannot see? */
  const editingPaidUnseen =
    target?.fee !== undefined &&
    feePayment(target.fee, db.expenses).paid &&
    feePayment(target.fee, db.expenses).expense === undefined;

  return (
    <Modal
      open={target !== null}
      title={
        target?.fee
          ? t("service.editChargeOn", "Change a charge on {{serial}}", {
              serial: target.serial,
            })
          : t("service.addChargeTo", "Charge on {{serial}}", {
              serial: target?.serial ?? "",
            })
      }
      okText={
        target?.fee
          ? t("service.saveCharge", "Save the change")
          : t("service.record", "Record it")
      }
      onCancel={() => {
        onClose();
        feeForm.resetFields();
      }}
      onOk={saveFee}
    >
      {target?.fee && (
        <Typography.Paragraph type="secondary">
          {t(
            "service.editChargeHint",
            "It was {{amount}}. The old figure stays on the unit's timeline.",
            { amount: fmtRp(target.fee.amount) },
          )}
        </Typography.Paragraph>
      )}
      <Form form={feeForm} layout="vertical">
        <Form.Item
          name="kind"
          label={t("service.feeKind", "Charge")}
          rules={[{ required: true }]}
        >
          <Select
            options={SERVICE_FEE_KINDS.map((k) => ({
              value: k.value,
              label: k.label,
              title: k.guide,
            }))}
          />
        </Form.Item>
        <Form.Item name="label" label={t("service.feeLabel", "What for")}>
          <Input
            placeholder={t(
              "service.feeLabelPlaceholder",
              "Ganti keyboard, ongkir ke Bandung…",
            )}
          />
        </Form.Item>
        <Form.Item
          name="amount"
          label={t("service.feeAmount", "Amount")}
          rules={[{ required: true }]}
        >
          <InputNumber
            min={0}
            precision={0}
            prefix={RP_SYMBOL}
            formatter={moneyFormatter}
            parser={moneyParser}
            style={{ width: "100%" }}
          />
        </Form.Item>
        {editingPaidUnseen ? (
          // Paid, by an expense this account is not sent: it stays paid,
          // and its amount follows the charge on the server.
          <Typography.Paragraph type="secondary">
            {t(
              "service.paidElsewhere",
              "Paid. A change to the amount changes its payment too.",
            )}
          </Typography.Paragraph>
        ) : (
          <PaidWithField
            name="paidWith"
            label={t("service.paidWith", "Paid with")}
          />
        )}
      </Form>
    </Modal>
  );
}
