/**
 * Add or correct one expense on a purchase invoice (owner ask 2026-09-18).
 *
 * > *"In payment section below it, add 'Add Expense' -> to add like
 * > additional payment, this is like what we owe, instead of 'record
 * > payment'. But in the 'Add Expense' should be able to mark as paid, which
 * > will automatically record the payment. When adding expense we should be
 * > able to add if we want to divide it to COGS per unit or not. This should
 * > be editable and automatically adjust the COGS per unit."*
 *
 * An expense is what the shop OWES because of this delivery — the forwarder,
 * the tax office, customs, a packing crate. Recording a payment is a separate
 * act, and this dialog does it only when asked: *Paid* records a payment for
 * whatever of the expense is still unpaid, tied to the expense by `feeId`, so
 * correcting the amount corrects that payment and un-ticking *Paid* takes it
 * back. *Split into COGS* is whether the expense joins what each machine on
 * the invoice cost (`lib/landedCost.ts`); every margin in the app reads the
 * answer the moment it is saved.
 */
import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Typography,
} from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { byFeeOrder } from "@nusantara/store";
import { MoneyInput } from "../../components/MoneyInput";
import { fmtRp } from "../../lib/format.js";
import { payTargetOfFee, poTotals } from "../../lib/inbound.js";
import { machinesOnInvoice } from "../../lib/landedCost.js";
import {
  PO_FEE_KIND_LABEL,
  type Po,
  type PoFee,
  type PoFeeKind,
} from "../../mock/seed.js";
import { mutate, nextId, useDb } from "../../mock/store.js";
import { isPickableMethod } from "../../lib/accounts.js";
import { SPACE, TYPE } from "../../theme/tokens";

const KINDS: readonly PoFeeKind[] = ["SHIPPING", "TAX", "CUSTOMS", "OTHER"];

export interface ExpenseModalProps {
  /** The invoice. Read live, so a payment recorded meanwhile is seen. */
  readonly po: Po;
  /** `null` is closed, `"new"` adds one, an id corrects that expense. */
  readonly editing: string | null;
  readonly onClose: () => void;
}

export function ExpenseModal({ po, editing, onClose }: ExpenseModalProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const db = useDb();
  const fee =
    editing !== null && editing !== "new"
      ? po.fees.find((f) => f.id === editing)
      : undefined;
  const standing = useMemo(
    () => poTotals(po).feeStandings.find((s) => s.fee.id === fee?.id),
    [po, fee?.id],
  );
  /** Paid in full when the dialog opened — the switch's starting position. */
  const wasPaid = standing !== undefined && standing.owed === 0;

  const [kind, setKind] = useState<PoFeeKind>("SHIPPING");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState<number | undefined>();
  const [inCogs, setInCogs] = useState(true);
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<string | undefined>("TUNAI");

  useEffect(() => {
    if (editing === null) return;
    setKind(fee?.kind ?? "SHIPPING");
    setLabel(fee?.label ?? "");
    setAmount(fee?.amount);
    setInCogs(fee?.inCogs ?? true);
    setPaid(wasPaid);
    setMethod(
      [...po.payments].reverse().find((p) => fee && p.feeId === fee.id)
        ?.method ?? "TUNAI",
    );
    // Seeded once per opening: re-running on every store change would reset
    // the dialog under the hand of somebody filling it in.
  }, [editing]);

  const methods = db.paymentMethods.filter(
    (m) =>
      (m.forPo && m.active && isPickableMethod(m.code)) || m.code === method,
  );
  /** How many machines the invoice's COGS expenses are spread over. */
  const machines = machinesOnInvoice(po, db.units);
  /** The payments this dialog made for the expense, newest last. */
  const linked = fee ? po.payments.filter((p) => p.feeId === fee.id) : [];
  const linkedTotal = linked.reduce((n, p) => n + p.amount, 0);

  const save = () => {
    if (amount === undefined || !(amount > 0)) {
      message.error(t("inbound.expenseAmountNeeded", "Enter how much it is."));
      return;
    }
    if (paid && !wasPaid && !method) {
      message.error(
        t(
          "inbound.pickAMethod",
          "Say how the money moved before recording it.",
        ),
      );
      return;
    }
    const id = fee?.id ?? nextId("pof");
    const now = new Date().toISOString();
    mutate((d) => {
      const order = d.pos.find((p) => p.id === po.id);
      if (!order) return;
      const next: PoFee = { id, kind, label: label.trim(), amount, inCogs };
      order.fees = [...order.fees.filter((f) => f.id !== id), next].sort(
        byFeeOrder,
      );
      const mine = order.payments.filter((p) => p.feeId === id);
      // Every payment of this expense files under the bucket its kind is.
      for (const p of mine) p.appliedTo = payTargetOfFee(kind);
      if (paid) {
        const settled = poTotals(order).feeStandings.find(
          (s) => s.fee.id === id,
        );
        const owed = settled?.owed ?? amount;
        if (owed > 0 && method) {
          order.payments.push({
            id: nextId("pp"),
            method,
            amount: owed,
            at: now,
            appliedTo: payTargetOfFee(kind),
            feeId: id,
          });
        }
        // Lowered while paid: the expense's own payments come down with it,
        // newest first, so the invoice does not carry money it never owed.
        let over = mine.reduce((n, p) => n + p.amount, 0) - amount;
        for (const p of [...mine].reverse()) {
          if (over <= 0) break;
          const cut = Math.min(p.amount, over);
          over -= cut;
          if (cut === p.amount) {
            order.payments = order.payments.filter((x) => x.id !== p.id);
          } else {
            p.amount -= cut;
          }
        }
      } else if (wasPaid) {
        // Un-ticked: what this dialog recorded for it is taken back.
        order.payments = order.payments.filter((p) => p.feeId !== id);
      }
    });
    message.success(
      fee
        ? t("inbound.expenseUpdated", "Expense updated.")
        : paid
          ? t(
              "inbound.expenseAddedPaid",
              "Expense added and its payment recorded.",
            )
          : t(
              "inbound.expenseAdded",
              "Expense added — it is now owed on this invoice.",
            ),
    );
    onClose();
  };

  const remove = () => {
    if (!fee) return;
    modal.confirm({
      title: t("inbound.expenseRemoveTitle", "Remove this expense?"),
      content:
        linkedTotal > 0
          ? t(
              "inbound.expenseRemoveBodyPaid",
              "It stops being owed, and the {{amount}} recorded as paying it is taken back with it.",
              { amount: fmtRp(linkedTotal) },
            )
          : t(
              "inbound.expenseRemoveBody",
              "It stops being owed on this invoice, and stops counting towards the units' cost.",
            ),
      okText: t("inbound.expenseRemoveOk", "Remove expense"),
      okButtonProps: { danger: true },
      onOk: () => {
        mutate((d) => {
          const order = d.pos.find((p) => p.id === po.id);
          if (!order) return;
          order.fees = order.fees.filter((f) => f.id !== fee.id);
          order.payments = order.payments.filter((p) => p.feeId !== fee.id);
        });
        message.success(t("inbound.expenseRemoved", "Expense removed."));
        onClose();
      },
    });
  };

  const each =
    amount !== undefined && amount > 0 && machines > 0
      ? Math.floor(amount / machines)
      : 0;

  return (
    <Modal
      open={editing !== null}
      centered
      title={
        fee
          ? t("inbound.editExpense", "Edit expense")
          : t("inbound.addExpense", "Add expense")
      }
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Flex justify="space-between" gap={SPACE.sm} wrap>
          <span>
            {fee && (
              <Button
                danger
                icon={<DeleteOutlined aria-hidden />}
                onClick={remove}
              >
                {t("inbound.expenseRemoveOk", "Remove expense")}
              </Button>
            )}
          </span>
          <Flex gap={SPACE.sm}>
            <Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
            <Button type="primary" onClick={save}>
              {fee
                ? t("inbound.saveChanges", "Save changes")
                : t("inbound.addExpense", "Add expense")}
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Form layout="vertical" component="div">
        <Flex gap={SPACE.md} wrap>
          <Form.Item
            label={t("inbound.expenseKind", "Type")}
            style={{ flex: "1 1 160px", marginBottom: SPACE.md }}
          >
            <Select<PoFeeKind>
              value={kind}
              onChange={setKind}
              aria-label={t("inbound.expenseKind", "Type")}
              options={KINDS.map((k) => ({
                value: k,
                label: t(PO_FEE_KIND_LABEL[k]),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("inbound.expenseLabel", "Name")}
            style={{ flex: "2 1 220px", marginBottom: SPACE.md }}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label={t("inbound.expenseLabel", "Name")}
              placeholder={t(
                "inbound.expenseLabelHint",
                "Optional — e.g. JNE Cargo",
              )}
            />
          </Form.Item>
        </Flex>
        <Form.Item
          label={t("inbound.amount", "Amount")}
          required
          style={{ marginBottom: SPACE.md }}
        >
          <MoneyInput
            value={amount}
            onChange={(v) => setAmount(v ?? undefined)}
            aria-label={t("inbound.amount", "Amount")}
          />
        </Form.Item>
        <Form.Item style={{ marginBottom: SPACE.md }}>
          <Flex vertical gap={SPACE.xs}>
            <Flex align="center" gap={SPACE.sm}>
              <Switch
                checked={inCogs}
                onChange={setInCogs}
                aria-label={t(
                  "inbound.expenseInCogs",
                  "Split into COGS per unit",
                )}
              />
              <Typography.Text>
                {t("inbound.expenseInCogs", "Split into COGS per unit")}
              </Typography.Text>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {inCogs
                ? machines > 0 && each > 0
                  ? t(
                      "inbound.expenseInCogsEach",
                      "About {{each}} on each of the {{n}} units' cost.",
                      { each: fmtRp(each), n: machines },
                    )
                  : t(
                      "inbound.expenseInCogsLater",
                      "Shared evenly by the units on this invoice.",
                    )
                : t(
                    "inbound.expenseNotInCogs",
                    "Owed on the invoice, but no unit's cost includes it.",
                  )}
            </Typography.Text>
          </Flex>
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Flex vertical gap={SPACE.sm}>
            <Flex align="center" gap={SPACE.sm}>
              <Switch
                checked={paid}
                onChange={setPaid}
                aria-label={t("inbound.expensePaid", "Paid")}
              />
              <Typography.Text>
                {t("inbound.expensePaid", "Paid")}
              </Typography.Text>
            </Flex>
            {paid && !wasPaid && (
              <Flex vertical gap={SPACE.xs}>
                <Select
                  value={method}
                  onChange={setMethod}
                  allowClear
                  status={!method ? "error" : undefined}
                  placeholder={t("inbound.pickMethod", "How the money moved")}
                  aria-label={t("inbound.method", "Method")}
                  options={methods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                />
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {t(
                    "inbound.expensePaidHint",
                    "Records a payment for what is still unpaid on it, today.",
                  )}
                </Typography.Text>
              </Flex>
            )}
            {!paid && wasPaid && linkedTotal > 0 && (
              <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
                {t(
                  "inbound.expenseUnpaidHint",
                  "Saving takes back the {{amount}} recorded as paying it.",
                  { amount: fmtRp(linkedTotal) },
                )}
              </Typography.Text>
            )}
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  );
}
