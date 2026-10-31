/**
 * The daily count — the bank's balance and the drawer's, against the POS
 * (owner ask 2026-10-27, answer 1B: bank AND cash). `lib/reconciliation.ts`
 * holds every rule; this file is the two dialogs.
 *
 * `StartReconcileModal` asks for the day, the bank's balance and the counted
 * cash. A pot that agrees with the POS is saved MATCHED there and then; a pot
 * that does not opens `DailyPotModal`: that day's movements of that pot, the
 * amounts editable, the difference updating as they are typed, *Add a
 * transaction* for what the POS never heard of, and a note. A changed row is
 * tinted, so whoever saves can see what they are about to correct.
 */
import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  Button,
  Collapse,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import {
  fmtDate,
  fmtDateTime,
  fmtNone,
  fmtRp,
  fmtTime,
} from "../../lib/format.js";
import { accountOfMethod } from "../../lib/accounts.js";
import { cashflowRows, type CashflowRow } from "../../lib/cashflowRows.js";
import {
  applyAmountEdit,
  dailyOf,
  dailyStatus,
  editBlock,
  editRows,
  posBalanceAt,
  potMovements,
  refKey,
  refOf,
  rowRefKey,
  upsertDaily,
  type EditBlock,
  type MoneyEdit,
  type Pot,
} from "../../lib/reconciliation.js";
import type { MockDb, MoneyRef, ReconciliationEdit } from "../../mock/seed.js";
import { currentStaffName, mutate, nextId, useDb } from "../../mock/store.js";
import { COLUMN, SPACE } from "../../theme/tokens";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { AdjustmentPanel, type RecordedAdjustment } from "./AdjustmentPanel";
import type { TFunction } from "../../i18n/translate.js";

/** A pot's name, as literal `t()` calls so `test/i18n.test.ts` sees them. */
export function potLabel(pot: Pot, t: TFunction): string {
  return pot === "BANK" ? t("recon.bank", "Bank") : t("recon.cash", "Cash");
}

/** Why an amount cannot be corrected here, in words. */
export function editBlockText(block: EditBlock, t: TFunction): string {
  switch (block) {
    case "NOT_FOUND":
      return t("recon.blockNotFound", "This record is no longer there.");
    case "SALE_LOCKED":
      return t(
        "recon.blockSaleLocked",
        "This sale is finished inside a closed month. Reopen the book to correct it.",
      );
    case "BOOKS_CLOSED":
      return t(
        "recon.blockBooksClosed",
        "The book is closed over this date. Reopen it to correct the amount.",
      );
    case "SERVICE_CHARGE":
      return t(
        "recon.blockServiceCharge",
        "This pays a service charge — correct the charge on the service bench and this follows.",
      );
    case "TRADE_IN":
      return t(
        "recon.blockTradeIn",
        "This pays for a trade-in — correct it in the sale's Edit transaction.",
      );
    case "INVOICE_CLOSED":
      return t(
        "recon.blockInvoiceClosed",
        "The supplier invoice is closed. Reopen it to correct its payment.",
      );
    case "BELOW_ALLOCATED":
      return t(
        "recon.blockBelowAllocated",
        "More than this has already been put against invoices out of this deposit.",
      );
    case "NOT_POSITIVE":
      return t(
        "recon.blockNotPositive",
        "An amount must be above zero. Delete the record on its own screen instead.",
      );
  }
}

/** What a sale's payment was for — the units and pieces on the receipt. */
export function itemsOfOrder(db: MockDb, orderId: string): string {
  const o = db.orders.find((x) => x.id === orderId);
  if (o === undefined) return "";
  const name = (skuId: string | undefined) => {
    const sku = db.skus.find((k) => k.id === skuId);
    return sku ? `${sku.name} ${sku.variantLabel}`.trim() : "";
  };
  return [
    ...o.serials.map(
      (s) => name(db.units.find((u) => u.serial === s)?.skuId) || s,
    ),
    ...(o.lines ?? []).map((l) => `${name(l.skuId)} ×${l.qty}`),
  ]
    .filter(Boolean)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Starting a count
// ---------------------------------------------------------------------------

interface StartValues {
  day: Dayjs;
  bank?: number | null;
  cash?: number | null;
}

/** What the start dialog hands on: the pots that did not agree. */
export interface PotToCount {
  readonly pot: Pot;
  readonly day: string;
  readonly actual: number;
}

export function StartReconcileModal({
  open,
  onClose,
  onMismatch,
  initialDay,
}: {
  open: boolean;
  onClose: () => void;
  /** The pots whose count differs from the POS, bank first. */
  onMismatch: (pots: PotToCount[]) => void;
  initialDay?: string;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm<StartValues>();
  const rows = useMemo(() => cashflowRows(db, t), [db, t]);

  const save = () =>
    form.validateFields().then((v) => {
      const day = v.day.format("YYYY-MM-DD");
      const counted: PotToCount[] = [];
      if (typeof v.bank === "number")
        counted.push({ pot: "BANK", day, actual: v.bank });
      if (typeof v.cash === "number")
        counted.push({ pot: "CASH", day, actual: v.cash });
      if (counted.length === 0) {
        message.warning(
          t(
            "recon.enterOne",
            "Enter the bank balance, the counted cash, or both.",
          ),
        );
        return;
      }
      const mismatched: PotToCount[] = [];
      const agreed: PotToCount[] = [];
      for (const c of counted) {
        const pos = posBalanceAt(rows, db.settings, c.pot, day);
        if (pos === c.actual) agreed.push(c);
        else mismatched.push(c);
      }
      if (agreed.length > 0) {
        const at = new Date().toISOString();
        mutate((d) => {
          for (const c of agreed) {
            upsertDaily(
              d,
              {
                pot: c.pot,
                day,
                posBalance: c.actual,
                actualBalance: c.actual,
                status: "MATCHED",
                edits: [],
              },
              { at, staff: currentStaffName(), nextId },
            );
          }
        });
        message.success(
          t("recon.matchedPots", "{{pots}} matches the POS.", {
            pots: agreed.map((c) => potLabel(c.pot, t)).join(" & "),
          }),
        );
      }
      form.resetFields();
      onClose();
      if (mismatched.length > 0) onMismatch(mismatched);
    });

  return (
    <Modal
      open={open}
      title={t("recon.reconcileTitle", "Reconcile a day")}
      okText={t("recon.check", "Check against the POS")}
      onOk={save}
      onCancel={onClose}
      width={compact ? "100%" : 480}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ day: initialDay ? dayjs(initialDay) : dayjs() }}
      >
        <Form.Item
          name="day"
          label={t("recon.day", "Day")}
          rules={[
            { required: true, message: t("recon.pickDay", "Pick the day.") },
          ]}
        >
          <DatePicker
            format="DD MMM YYYY"
            style={{ width: "100%" }}
            disabledDate={(d) => d.isAfter(dayjs(), "day")}
          />
        </Form.Item>
        <Form.Item
          name="bank"
          label={t("recon.actualBank", "Bank balance (from the bank)")}
        >
          <MoneyInput
            style={{ width: "100%" }}
            aria-label={t("recon.actualBank", "Bank balance (from the bank)")}
          />
        </Form.Item>
        <Form.Item
          name="cash"
          label={t("recon.countedCash", "Cash counted in the drawer")}
        >
          <MoneyInput
            style={{ width: "100%" }}
            aria-label={t("recon.countedCash", "Cash counted in the drawer")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// One pot that does not agree
// ---------------------------------------------------------------------------

export function DailyPotModal({
  count,
  onClose,
}: {
  /** The pot, the day and what was counted; undefined when closed. */
  count: PotToCount | undefined;
  onClose: () => void;
}) {
  const open = count !== undefined;
  return open ? (
    <PotDialog
      key={`${count.pot}-${count.day}`}
      count={count}
      onClose={onClose}
    />
  ) : null;
}

function PotDialog({
  count,
  onClose,
}: {
  count: PotToCount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const { compact } = useLayoutMode();
  const { pot, day } = count;
  const [actual, setActual] = useState<number>(count.actual);
  /** Edited amounts, by row key. */
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  /** What *Add a transaction* wrote while this dialog was open. */
  const [added, setAdded] = useState<{ ref: MoneyRef; amount: number }[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const existing = dailyOf(db, pot, day);
  const [note, setNote] = useState<string>(existing?.note ?? "");
  const [noteError, setNoteError] = useState(false);

  const rows = useMemo(() => cashflowRows(db, t), [db, t]);
  const movements = useMemo(
    () => potMovements(rows, db.settings, pot, day, day),
    [rows, db.settings, pot, day],
  );
  const posBase = posBalanceAt(rows, db.settings, pot, day);
  const changed = (r: CashflowRow) =>
    amounts[r.key] !== undefined && amounts[r.key] !== r.amount;
  const delta = movements.reduce(
    (n, r) =>
      changed(r)
        ? n + (r.direction === "INCOME" ? 1 : -1) * (amounts[r.key]! - r.amount)
        : n,
    0,
  );
  const posNow = posBase + delta;
  const difference = actual - posNow;
  const addedKeys = new Set(added.map((a) => refKey(a.ref)));

  const recorded = (written: RecordedAdjustment[]) =>
    setAdded((a) => [
      ...a,
      ...written
        .filter((w) => accountOfMethod(w.method) === pot)
        .map((w) => ({
          ref: w.kind === "expense" ? { expenseId: w.id } : { incomeId: w.id },
          amount: w.amount,
        })),
    ]);

  const save = () => {
    if (difference !== 0 && note.trim() === "") {
      setNoteError(true);
      return;
    }
    const ctx = {
      at: new Date().toISOString(),
      staff: currentStaffName(),
      nextId,
    };
    let status = "";
    mutate((d) => {
      const edits: MoneyEdit[] = [];
      for (const r of movements) {
        if (!changed(r) || r.source === undefined) continue;
        if (editBlock(d, r.source, amounts[r.key]) !== undefined) continue;
        edits.push(...applyAmountEdit(d, r.source, amounts[r.key]!, ctx));
      }
      const log = editRows(edits, added, ctx);
      const after = posBalanceAt(cashflowRows(d, t), d.settings, pot, day);
      const before = dailyOf(d, pot, day);
      const s = dailyStatus(
        actual - after,
        log.length > 0 || (before?.edits.length ?? 0) > 0,
      );
      status = s;
      upsertDaily(
        d,
        {
          pot,
          day,
          posBalance: after,
          actualBalance: actual,
          status: s,
          ...(note.trim() ? { note } : {}),
          edits: log,
        },
        ctx,
      );
    });
    message.success(
      status === "OPEN"
        ? t("recon.savedOpen", "Saved with the difference left open.")
        : t("recon.savedBalanced", "{{pot}} reconciled.", {
            pot: potLabel(pot, t),
          }),
    );
    onClose();
  };

  const editsLog = existing?.edits ?? [];

  return (
    <Modal
      open
      title={t("recon.potTitle", "Reconcile {{pot}} — {{day}}", {
        pot: potLabel(pot, t),
        day: fmtDate(day),
      })}
      okText={t("recon.save", "Save reconciliation")}
      onOk={save}
      onCancel={onClose}
      width={compact ? "100%" : 960}
      destroyOnHidden
    >
      <Flex gap={SPACE.lg} wrap style={{ marginBottom: SPACE.md }}>
        <Flex vertical>
          <Typography.Text type="secondary">
            {t("recon.posBalance", "POS balance")}
          </Typography.Text>
          <Typography.Text strong data-testid="recon-pos">
            {fmtRp(posNow)}
          </Typography.Text>
        </Flex>
        <Flex vertical>
          <Typography.Text type="secondary">
            {pot === "BANK"
              ? t("recon.actualBank", "Bank balance (from the bank)")
              : t("recon.countedCash", "Cash counted in the drawer")}
          </Typography.Text>
          <MoneyInput
            value={actual}
            onChange={(v) => setActual(v ?? 0)}
            aria-label={t("recon.actual", "Actual balance")}
          />
        </Flex>
        <Flex vertical>
          <Typography.Text type="secondary">
            {t("recon.difference", "Difference")}
          </Typography.Text>
          <Typography.Text
            strong
            type={difference === 0 ? "success" : "danger"}
            data-testid="recon-difference"
          >
            {fmtRp(difference)}
          </Typography.Text>
        </Flex>
      </Flex>

      <Table<CashflowRow>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={movements}
        rowClassName={(r) =>
          changed(r)
            ? "recon-row-changed"
            : addedKeys.has(rowRefKey(r) ?? "")
              ? "recon-row-added"
              : ""
        }
        locale={{
          emptyText: t(
            "recon.noMovements",
            "Nothing moved through this pot on this day.",
          ),
        }}
        columns={[
          {
            title: t("recon.time", "Time"),
            key: "at",
            width: COLUMN.qty,
            render: (_: unknown, r) => fmtTime(r.at),
          },
          {
            title: t("finance.transactionId", "Transaction ID"),
            key: "code",
            width: COLUMN.code,
            render: (_: unknown, r) => r.orderCode ?? fmtNone(),
          },
          {
            title: t("finance.type", "Type"),
            key: "type",
            width: COLUMN.tag,
            render: (_: unknown, r) =>
              r.direction === "INCOME" ? (
                <Tag color="green">{t("finance.income", "Income")}</Tag>
              ) : (
                <Tag color="red">{t("finance.expense", "Expense")}</Tag>
              ),
          },
          {
            title: t("recon.descriptionItem", "Description / item"),
            key: "description",
            render: (_: unknown, r) => {
              const items =
                r.source?.kind === "salePayment"
                  ? itemsOfOrder(db, r.source.orderId)
                  : "";
              return (
                <Flex vertical>
                  <span>{r.description || fmtNone()}</span>
                  {items && (
                    <Typography.Text type="secondary">{items}</Typography.Text>
                  )}
                  {addedKeys.has(rowRefKey(r) ?? "") && (
                    <span>
                      <Tag color="blue">{t("recon.added", "Added")}</Tag>
                    </span>
                  )}
                </Flex>
              );
            },
          },
          {
            title: t("finance.amount", "Amount"),
            key: "amount",
            width: COLUMN.moneyInput + 24,
            align: "right",
            render: (_: unknown, r) => {
              const block =
                r.source === undefined ? "NOT_FOUND" : editBlock(db, r.source);
              const value = amounts[r.key] ?? r.amount;
              // What a marketplace kept is read off the sale's payout and
              // corrected where the payout is: Edit transaction.
              if (r.feeOf !== undefined)
                return (
                  <Tooltip
                    title={
                      r.category === "TUKAR_TAMBAH"
                        ? t(
                            "recon.tradeInOnSale",
                            "This is the sale's trade-in — it follows the sale.",
                          )
                        : t(
                            "recon.feeEditedOnSale",
                            "Correct this deduction in the sale's Edit transaction.",
                          )
                    }
                  >
                    <span>{fmtRp(r.amount)}</span>
                  </Tooltip>
                );
              if (block !== undefined)
                return (
                  <Tooltip title={editBlockText(block, t)}>
                    <span>{fmtRp(r.amount)}</span>
                  </Tooltip>
                );
              return (
                <Flex vertical align="end">
                  <MoneyInput
                    value={value}
                    min={1}
                    aria-label={t("recon.amountOf", "Amount of {{what}}", {
                      what: r.orderCode ?? r.description,
                    })}
                    onChange={(v) =>
                      setAmounts((a) => ({ ...a, [r.key]: v ?? r.amount }))
                    }
                  />
                  {changed(r) && (
                    <Typography.Text type="secondary" delete>
                      {fmtRp(r.amount)}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
        ]}
      />

      <Flex justify="space-between" style={{ marginTop: SPACE.sm }}>
        <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          {t("recon.addTransaction", "Add a transaction")}
        </Button>
      </Flex>

      <Form layout="vertical" style={{ marginTop: SPACE.md }}>
        <Form.Item
          label={t("recon.note", "Note")}
          required={difference !== 0}
          validateStatus={noteError && note.trim() === "" ? "error" : undefined}
          help={
            noteError && note.trim() === ""
              ? t(
                  "recon.noteNeeded",
                  "Say why the difference is left — it is saved as open.",
                )
              : undefined
          }
        >
          <Input.TextArea
            rows={2}
            value={note}
            aria-label={t("recon.note", "Note")}
            onChange={(e) => setNote(e.target.value)}
          />
        </Form.Item>
      </Form>

      {difference !== 0 && (
        <Alert
          type="warning"
          showIcon
          title={t(
            "recon.leftOpen",
            "A difference of {{amount}} is left. Saving now keeps this day open.",
            { amount: fmtRp(difference) },
          )}
        />
      )}

      {editsLog.length > 0 && (
        <Collapse
          style={{ marginTop: SPACE.md }}
          items={[
            {
              key: "log",
              label: t(
                "recon.whatChanged",
                "What this reconciliation changed ({{n}})",
                {
                  n: editsLog.length,
                },
              ),
              children: <EditLog db={db} edits={editsLog} />,
            },
          ]}
        />
      )}

      <AdjustmentPanel
        addOpen={addOpen}
        onCloseAdd={() => setAddOpen(false)}
        showHistory={false}
        preset={{ date: day, method: pot === "BANK" ? "TRANSFER" : "TUNAI" }}
        onRecorded={recorded}
      />
    </Modal>
  );
}

/** A reconciliation's log: what it corrected and added, before → after, who. */
export function EditLog({
  db,
  edits,
}: {
  db: MockDb;
  edits: readonly ReconciliationEdit[];
}) {
  const { t } = useTranslation();
  const rows = cashflowRows(db, t);
  const byRef = new Map(
    rows.flatMap((r) =>
      r.source === undefined ? [] : [[refKey(refOf(r.source)), r] as const],
    ),
  );
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={[...edits].reverse()}
      columns={[
        {
          title: t("recon.when", "When"),
          dataIndex: "at",
          width: COLUMN.date + 40,
          render: (v: string) => fmtDateTime(v),
        },
        {
          title: t("recon.record", "Record"),
          key: "record",
          render: (_: unknown, e) => {
            const r = byRef.get(refKey(e));
            return r
              ? [r.orderCode, r.description].filter(Boolean).join(" · ")
              : fmtNone();
          },
        },
        {
          title: t("recon.change", "Change"),
          key: "change",
          width: 260,
          render: (_: unknown, e) =>
            e.action === "ADDED" ? (
              <span>
                <Tag color="blue">{t("recon.added", "Added")}</Tag>
                {fmtRp(e.after)}
              </span>
            ) : (
              `${fmtRp(e.before)} → ${fmtRp(e.after)}`
            ),
        },
        {
          title: t("recon.who", "Who"),
          dataIndex: "staff",
          width: COLUMN.choice,
        },
      ]}
    />
  );
}
