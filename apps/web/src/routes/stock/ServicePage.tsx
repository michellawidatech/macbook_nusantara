/**
 * The service bench — every machine away at a repairer, and what it is costing.
 *
 * > *"In warehouse 4, we should be able to add the service fee per unit and
 * > another additional fee if the unit is then transferred to another
 * > warehouse. The service will be included to count the COGS."*
 * > — owner, 2026-09-08
 *
 * ## Why this is its own screen
 *
 * A machine at a repairer is stock the shop still owns and cannot sell, and it
 * behaves like nothing else in the building: it accrues cost while it sits
 * there, it has no shelf, and the question asked of it every morning is "how
 * long has that been gone?". Inventory answers "how many do we have"; the
 * expandable serial list under a product row can show a machine is at service
 * and cannot show a queue of them ordered by how overdue they are.
 *
 * ## Cost, and where it lands
 *
 * Each fee is one charge from one party — labour, a part, the courier — and
 * the total joins `Unit.buy` and the machine's share of its invoice's shipping
 * and tax (2026-09-15) in `costOfUnit`, which is what every margin in the app
 * is now computed against. `Unit.buy` itself is untouched: it is what
 * the machine cost to ACQUIRE, it is on a supplier's invoice, and rewriting it
 * would make the two disagree forever.
 *
 * Sending the machine back asks for the destination and lets one more fee be
 * added on the way out — the transfer itself, which is the owner's *"another
 * additional fee if the unit is then transferred"*.
 *
 * ## The bench in three steps (owner revision 2026-09-09)
 *
 * > *"So in 'Servis', the flow would be: See each unit that is supposed to be
 * > 'Serviced' or have the 'Service' status so that they know which unit is
 * > supposed to be there, mark it as arrived & start service, and adjust the
 * > fee."*
 *
 * That was two tables — **Expected**, sent and not signed for, and **On the
 * bench**, arrived — until the owner asked for **one** (2026-09-25):
 * *Serial | Problem | Sent from | Quoted | actions*. The three steps did not
 * change, only the number of lists: signing a unit in is the tick on a row
 * that has not had it, and it is still the thing that moves
 * `Unit.locationId`. Before that confirmation existed, sending a unit put it
 * in warehouse 4 instantly and the bench had a list of units that were not
 * there.
 *
 * Every charge is editable afterwards, which is the third step — *"not only
 * add but also reduce"*. A repairer who quotes Rp900k and bills Rp650k is the
 * ordinary case. The charges are behind the row, which is the one door to
 * correcting one and why the merge did not take the expansion with it.
 *
 * ⚠️ Three columns went with the split and nothing replaced them: **Grade**,
 * **Away** (the days-gone tag, amber past a fortnight) and **Cost now**
 * (`costOfUnit` — bought, its share of the invoice's shipping and tax, and
 * every repair). The money is still recorded and still reaches every margin;
 * this screen just stopped printing the total. `BenchRow` still carries
 * `grade`-adjacent fields, `days`, `total`, `buy`, `shippingTax` and
 * `earlierRepair`, so putting any of them back is a column.
 *
 * ## Paid or owed, and taking things back (owner asks 2026-10-26)
 *
 * - **The Bench card is gone.** It printed the warehouse whose `Location.kind`
 *   is SERVIS, and in the shop's database that is 04, *Gudang Masuk Belum QC*
 *   — the receiving room. Where a unit is serviced is asked when it is sent.
 * - **Every charge says how it was paid** — Bank, Other bank, Cash — or that
 *   it is *Not paid yet*. A paid one is an `Expense` of kind UNIT naming it, so
 *   service money reaches Income & Expense; an owed one carries a *Mark paid*.
 *   Rules and the money's shape: `lib/serviceActions.ts`.
 * - **A charge can be deleted**, and so can a **whole visit** (two-layer
 *   confirm: the dialog, then the serial typed back). Both take the history
 *   rows they wrote with them through the ordinary remove-event path, so a
 *   deleted visit's unit is back to what it was before it was sent. Refused
 *   once the unit has moved on, and inside a closed book.
 * - **Back in stock offers every active warehouse**, defaulting to where the
 *   unit set out from. Excluding "the bench" while defaulting to it is what
 *   drew a raw `wh-04` in the box.
 */
import { ServiceBatchModal } from "../../components/ServiceBatchModal";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { SerialLink } from "../../components/SerialLink";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import {
  PaidWithField,
  usePaidWithLabel,
} from "../../components/SendToServiceModal";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import {
  SERVICE_FEE_KINDS,
  benchRows,
  editFee,
  visitCost,
  type BenchRow,
  type ServiceFee,
  type ServiceFeeKind,
} from "../../lib/service.js";
import {
  chargeExpense,
  feePayment,
  instantClosed,
  localDay,
  planChargeDeletion,
  planVisitDeletion,
  type PaidWith,
} from "../../lib/serviceActions.js";
import {
  appendEvent,
  mutate,
  nextId,
  removeEvent,
  useDb,
  currentStaffName,
} from "../../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { warehouseLabelOf } from "../../lib/warehouses.js";
import type { MockDb } from "../../mock/seed.js";

/** Out of the draft, so a rule reads the store as the mutation sees it. */
const sourcesOf = (d: MockDb) => ({
  events: d.events,
  expenses: d.expenses,
  settings: d.settings,
});

export function ServicePage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const paidWord = usePaidWithLabel();
  const [addingTo, setAddingTo] = useState<BenchRow | null>(null);
  /**
   * The charge being corrected, and the visit it belongs to.
   *
   * The same dialog as adding one — the questions are identical, and two
   * dialogs that ask the same three things is two places for them to drift.
   * Which of the two it is decides the title, the button and what `saveFee`
   * writes.
   */
  const [editingFee, setEditingFee] = useState<{
    row: BenchRow;
    fee: ServiceFee;
  } | null>(null);
  /** The owed charge a *Mark paid* is open on. */
  const [payingFee, setPayingFee] = useState<{
    row: BenchRow;
    fee: ServiceFee;
  } | null>(null);
  const [returning, setReturning] = useState<BenchRow | null>(null);
  /** The visit whose deletion is being confirmed, and what has been typed. */
  const [deleting, setDeleting] = useState<BenchRow | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [feeForm] = Form.useForm<{
    kind: ServiceFeeKind;
    label?: string;
    amount: number;
    paidWith?: PaidWith;
  }>();
  const [payForm] = Form.useForm<{
    method: Exclude<PaidWith, "UNPAID">;
    day: Dayjs;
  }>();
  /**
   * Finished visits, listed too (owner ask 2026-10-26: any visit can be
   * deleted). Per visit to the page, never remembered: the bench is about
   * what is away NOW, and a list that reopens full of finished work is a list
   * that hides it.
   */
  const [showFinished, setShowFinished] = useState(false);
  const allRows = useMemo(
    () => benchRows(db, Date.now(), { includeClosed: showFinished }),
    [db.services, db.units, db.pos, db.events, showFinished],
  );
  /** What is away now — what the cards count. */
  const rows = allRows.filter((r) => !r.closed);

  const unitOf = (serial: string) => db.units.find((u) => u.serial === serial);
  const skuOf = (serial: string) => {
    const u = unitOf(serial);
    return u && db.skus.find((k) => k.id === u.skuId);
  };
  const warehouseName = (id: string | undefined) =>
    warehouseLabelOf(db.warehouses, id) ?? fmtNone();

  const totalCost = rows.reduce((n, r) => n + r.cost, 0);

  /*
   * ~~`markArrived`~~ went on 2026-09-25 (owner: *"no need to mark as
   * 'received' first"*). A unit now MOVES to where it is serviced in the same
   * transaction that promises it to a repairer — `SendToServiceModal` writes
   * it — so there is nothing left to confirm.
   */

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
      const target = editingFee ?? { row: addingTo!, fee: undefined };
      const row = target.row;
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
      setAddingTo(null);
      setEditingFee(null);
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

  /** *Mark paid* on an owed charge: its expense, on the day it was paid. */
  const markPaid = () =>
    payForm.validateFields().then((v) => {
      const { row, fee } = payingFee!;
      const at = new Date().toISOString();
      void mutate((d) => {
        const i = d.services.findIndex((r) => r.id === row.rec.id);
        if (i < 0) return;
        const rec = d.services[i]!;
        const now = rec.fees.find((f) => f.id === fee.id);
        // Paid in another tab since: nothing to do, and a second expense on
        // one charge is refused by the store anyway.
        if (!now || feePayment(now, d.expenses).paid) return;
        d.expenses.unshift(
          chargeExpense({
            id: nextId("exp"),
            serial: row.serial,
            fee: now,
            method: v.method,
            day: v.day.format("YYYY-MM-DD"),
            createdAt: at,
          }),
        );
        d.services[i] = {
          ...rec,
          fees: rec.fees.map((f) =>
            f.id === fee.id ? { ...f, paid: true as const } : f,
          ),
        };
      });
      setPayingFee(null);
      payForm.resetFields();
      message.success(
        t("service.markedPaid", "{{amount}} on {{serial}} is paid.", {
          amount: fmtRp(fee.amount),
          serial: row.serial,
        }),
      );
    });

  /**
   * Delete one charge: the charge, its expense, and the line it put on the
   * unit's timeline. Nothing is appended — a charge typed by mistake leaves
   * no trace (owner ask 2026-10-26).
   */
  const deleteFee = (row: BenchRow, fee: ServiceFee) => {
    const out: { block?: string } = {};
    void mutate((d) => {
      const i = d.services.findIndex((r) => r.id === row.rec.id);
      if (i < 0) return;
      const rec = d.services[i]!;
      const plan = planChargeDeletion(sourcesOf(d), rec, fee.id);
      if (plan.block) {
        out.block = plan.block;
        return;
      }
      d.services[i] = { ...rec, fees: rec.fees.filter((f) => f.id !== fee.id) };
      d.expenses = d.expenses.filter((e) => !plan.expenseIds.includes(e.id));
      for (const id of plan.eventIds) removeEvent(d, id);
    });
    if (out.block) {
      message.error(
        t(
          "service.chargeInClosedBook",
          "This charge is in a closed book — reopen the book to delete it.",
        ),
      );
      return;
    }
    message.success(
      t(
        "service.feeDeleted",
        "The {{amount}} charge on {{serial}} is deleted.",
        {
          amount: fmtRp(fee.amount),
          serial: row.serial,
        },
      ),
    );
  };

  /**
   * Delete a whole visit: every charge and its expense, the visit, and the
   * history rows it wrote — newest first, so the unit falls back to the row
   * before the send: the status and warehouse it had.
   */
  const deleteVisit = () => {
    const row = deleting!;
    const out: { block?: string; sendFound?: boolean } = {};
    void mutate((d) => {
      const i = d.services.findIndex((r) => r.id === row.rec.id);
      if (i < 0) return;
      const rec = d.services[i]!;
      const plan = planVisitDeletion(
        {
          ...sourcesOf(d),
          unitStatus: d.units.find((u) => u.serial === rec.serial)?.status,
        },
        rec,
      );
      if (plan.block) {
        out.block = plan.block;
        return;
      }
      out.sendFound = plan.sendEventFound;
      d.services.splice(i, 1);
      d.expenses = d.expenses.filter((e) => !plan.expenseIds.includes(e.id));
      for (const id of plan.eventIds) removeEvent(d, id);
    });
    if (out.block === "MOVED_ON") {
      message.error(
        t(
          "service.visitMovedOn",
          "{{serial}} has moved on since this visit — its history after it would no longer make sense.",
          { serial: row.serial },
        ),
      );
      return;
    }
    if (out.block === "BOOKS_CLOSED") {
      message.error(
        t(
          "service.visitInClosedBook",
          "This visit is in a closed book — reopen the book to delete it.",
        ),
      );
      return;
    }
    setDeleting(null);
    setDeleteTyped("");
    if (out.sendFound === false) {
      message.warning(
        t(
          "service.visitDeletedNoRow",
          "The visit is deleted, but the history row that sent {{serial}} was not found — remove it from the unit's history if it should go.",
          { serial: row.serial },
        ),
      );
      return;
    }
    message.success(
      t(
        "service.visitDeleted",
        "The visit is deleted and {{serial}} is back as it was.",
        { serial: row.serial },
      ),
    );
  };

  const feeCells = (r: BenchRow) => [
    {
      title: t("service.feeKind", "Charge"),
      key: "kind",
      width: COLUMN.status,
      render: (_: unknown, f: ServiceFee) =>
        SERVICE_FEE_KINDS.find((k) => k.value === f.kind)?.label ?? f.kind,
    },
    {
      title: t("service.feeLabel", "What for"),
      key: "label",
      render: (_: unknown, f: ServiceFee) => f.label ?? fmtNone(),
    },
    {
      title: t("service.feeWhen", "When"),
      key: "at",
      width: COLUMN.date,
      render: (_: unknown, f: ServiceFee) => fmtDate(f.at),
    },
    {
      title: t("service.feeAmount", "Amount"),
      key: "amount",
      width: COLUMN.money,
      align: "right" as const,
      render: (_: unknown, f: ServiceFee) => fmtRp(f.amount),
    },
    {
      /*
       * Paid or owed (owner ask 2026-10-26). A paid charge names its method
       * where this browser can see the expense, and says "Paid" where it
       * cannot; an owed one carries *Mark paid*.
       */
      title: t("service.payment", "Payment"),
      key: "paid",
      width: COLUMN.actionsPair,
      render: (_: unknown, f: ServiceFee) => {
        const pay = feePayment(f, db.expenses);
        if (pay.paid) {
          return (
            <Tag color="green">
              {pay.expense
                ? t("service.paidWithTag", "Paid · {{method}}", {
                    method: paidWord(pay.expense.method as PaidWith),
                  })
                : t("service.paidTag", "Paid")}
            </Tag>
          );
        }
        return (
          <Flex gap={SPACE.xs} align="center">
            <Tag color="orange">{t("service.notPaidTag", "Not paid")}</Tag>
            <Button
              size="small"
              aria-label={t(
                "service.markPaidAria",
                "Mark the {{amount}} charge on {{serial}} paid",
                { amount: fmtRp(f.amount), serial: r.serial },
              )}
              onClick={() => {
                setPayingFee({ row: r, fee: f });
                payForm.setFieldsValue({ method: "TRANSFER", day: dayjs() });
              }}
            >
              {t("service.markPaid", "Mark paid")}
            </Button>
          </Flex>
        );
      },
    },
    {
      /*
       * Correcting a charge (owner ask 2026-09-09): *"not only add but also
       * reduce"* — and since 2026-10-26, deleting one.
       */
      title: "",
      key: "edit",
      width: COLUMN.actions,
      render: (_: unknown, f: ServiceFee) => {
        const locked =
          planChargeDeletion(sourcesOf(db), r.rec, f.id).block !== undefined;
        return (
          <Flex gap={SPACE.xs} justify="end">
            <Tooltip title={t("service.editFee", "Change this charge")}>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                aria-label={t(
                  "service.editFeeAria",
                  "Change the {{amount}} charge on {{serial}}",
                  { amount: fmtRp(f.amount), serial: r.serial },
                )}
                onClick={() => {
                  setEditingFee({ row: r, fee: f });
                  const pay = feePayment(f, db.expenses);
                  feeForm.setFieldsValue({
                    kind: f.kind,
                    label: f.label ?? "",
                    amount: f.amount,
                    paidWith: pay.expense
                      ? (pay.expense.method as PaidWith)
                      : pay.paid
                        ? undefined
                        : "UNPAID",
                  });
                }}
              />
            </Tooltip>
            <Popconfirm
              title={t("service.deleteFeeTitle", "Delete this charge?")}
              description={t(
                "service.deleteFeeBody",
                "It leaves the unit's cost and its timeline, and a payment recorded for it goes too.",
              )}
              okText={t("service.deleteFeeOk", "Delete")}
              okButtonProps={{ danger: true }}
              disabled={locked}
              onConfirm={() => deleteFee(r, f)}
            >
              <Tooltip
                title={
                  locked
                    ? t(
                        "service.chargeInClosedBook",
                        "This charge is in a closed book — reopen the book to delete it.",
                      )
                    : t("service.deleteFee", "Delete this charge")
                }
              >
                <Button
                  size="small"
                  type="text"
                  danger
                  disabled={locked}
                  icon={<DeleteOutlined />}
                  aria-label={t(
                    "service.deleteFeeAria",
                    "Delete the {{amount}} charge on {{serial}}",
                    { amount: fmtRp(f.amount), serial: r.serial },
                  )}
                />
              </Tooltip>
            </Popconfirm>
          </Flex>
        );
      },
    },
  ];

  /** Is the charge being edited paid by an expense this browser cannot see? */
  const editingPaidUnseen =
    editingFee !== null &&
    feePayment(editingFee.fee, db.expenses).paid &&
    feePayment(editingFee.fee, db.expenses).expense === undefined;

  return (
    <PageContainer title={t("service.title", "Service bench")}>
      <Flex vertical gap={SPACE.md}>
        <Flex gap={SPACE.md} wrap>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.away", "Units away")}
              value={rows.length}
            />
          </Card>
          <Card style={{ flex: 1, minWidth: 200 }}>
            <Statistic
              title={t("service.spent", "Spent on repairs")}
              value={fmtRp(totalCost)}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "service.spentHint",
                "Added to what each unit cost, so the margin is honest.",
              )}
            </Typography.Text>
          </Card>
        </Flex>

        {/*
         * ONE table (owner ask 2026-09-25), where there were two — Expected
         * and On the bench — and no arrival step: a unit promised to a
         * repairer is MOVED in the same transaction when it travels.
         */}
        <Card
          title={t("service.atService", "At service")}
          extra={
            <Flex gap={SPACE.xs} align="center">
              <Switch
                size="small"
                checked={showFinished}
                onChange={setShowFinished}
                aria-label={t("service.showFinished", "Show finished")}
              />
              <Typography.Text style={{ fontSize: TYPE.sm }}>
                {t("service.showFinished", "Show finished")}
              </Typography.Text>
            </Flex>
          }
        >
          <Table<BenchRow>
            size="small"
            rowKey={(r) => r.rec.id}
            dataSource={allRows}
            // A finished visit is listed to be deleted, and reads as history.
            onRow={(r) => (r.closed ? { style: { opacity: 0.55 } } : {})}
            pagination={false}
            locale={{
              emptyText: t(
                "service.nothingAway",
                "Nothing is away at a repairer.",
              ),
            }}
            expandable={{
              rowExpandable: (r) => r.rec.fees.length > 0,
              expandedRowRender: (r) => (
                <Table<ServiceFee>
                  size="small"
                  rowKey="id"
                  dataSource={[...r.rec.fees]}
                  pagination={false}
                  columns={feeCells(r)}
                />
              ),
            }}
            columns={[
              {
                title: t("service.serial", "Serial"),
                key: "serial",
                render: (_, r) => {
                  const sku = skuOf(r.serial);
                  return (
                    <Flex vertical gap={0} align="flex-start">
                      <SerialLink serial={r.serial} />
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {sku
                          ? `${sku.name} ${sku.variantLabel}`
                          : t("service.unknownProduct", "Unknown product")}
                      </Typography.Text>
                    </Flex>
                  );
                },
              },
              {
                title: t("service.problem", "Problem"),
                key: "note",
                render: (_, r) => r.rec.note ?? fmtNone(),
              },
              {
                title: t("service.sentFrom", "Sent from"),
                key: "from",
                width: 170,
                render: (_, r) => warehouseName(r.rec.fromLocationId),
              },
              {
                /*
                 * What the repair has cost so far — the fees on THIS visit,
                 * paid or owed. The lines behind the row say what it is made
                 * of, and are where one of them is corrected.
                 */
                title: t("service.quoted", "Quoted"),
                key: "cost",
                width: COLUMN.money,
                align: "right",
                render: (_, r) => fmtRp(r.cost),
              },
              {
                /*
                 * Two labelled buttons (owner ask 2026-09-25) — everything a
                 * bench does to a unit at a repairer is one of them — and the
                 * visit's own delete beside them (2026-10-26).
                 */
                title: "",
                key: "actions",
                width: COLUMN.actionsWide + COLUMN.action,
                render: (_, r) => (
                  <Flex gap={SPACE.xs} justify="end" align="center">
                    {r.closed && (
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {t("service.finished", "Finished {{when}}", {
                          when: fmtDate(r.rec.closedAt!),
                        })}
                      </Tag>
                    )}
                    {!r.closed && (
                      <Button
                        size="small"
                        type="primary"
                        icon={<PlusOutlined />}
                        aria-label={t(
                          "service.addFeeAria",
                          "Add a charge to {{serial}}",
                          { serial: r.serial },
                        )}
                        onClick={() => {
                          setAddingTo(r);
                          feeForm.setFieldsValue({
                            kind: "LABOUR",
                            paidWith: "UNPAID",
                          });
                        }}
                      >
                        {t("service.charge", "Charge")}
                      </Button>
                    )}
                    {!r.closed && (
                      <Button
                        size="small"
                        type="primary"
                        icon={<InboxOutlined />}
                        aria-label={t(
                          "service.sendBackAria",
                          "Put {{serial}} back in stock",
                          { serial: r.serial },
                        )}
                        onClick={() => {
                          setReturning(r);
                        }}
                      >
                        {t("service.backInStockShort", "Back in stock")}
                      </Button>
                    )}
                    <Tooltip
                      title={t("service.deleteVisit", "Delete this visit")}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t(
                          "service.deleteVisitAria",
                          "Delete the service visit of {{serial}}",
                          { serial: r.serial },
                        )}
                        onClick={() => {
                          setDeleteTyped("");
                          setDeleting(r);
                        }}
                      />
                    </Tooltip>
                  </Flex>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <Modal
        open={addingTo !== null || editingFee !== null}
        title={
          editingFee
            ? t("service.editChargeOn", "Change a charge on {{serial}}", {
                serial: editingFee.row.serial,
              })
            : t("service.addChargeTo", "Charge on {{serial}}", {
                serial: addingTo?.serial ?? "",
              })
        }
        okText={
          editingFee
            ? t("service.saveCharge", "Save the change")
            : t("service.record", "Record it")
        }
        onCancel={() => {
          setAddingTo(null);
          setEditingFee(null);
          feeForm.resetFields();
        }}
        onOk={saveFee}
      >
        {editingFee && (
          <Typography.Paragraph type="secondary">
            {t(
              "service.editChargeHint",
              "It was {{amount}}. The old figure stays on the unit's timeline.",
              { amount: fmtRp(editingFee.fee.amount) },
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

      <Modal
        open={payingFee !== null}
        title={t(
          "service.markPaidTitle",
          "Mark {{amount}} on {{serial}} paid",
          {
            amount: fmtRp(payingFee?.fee.amount ?? 0),
            serial: payingFee?.row.serial ?? "",
          },
        )}
        okText={t("service.markPaid", "Mark paid")}
        onCancel={() => {
          setPayingFee(null);
          payForm.resetFields();
        }}
        onOk={markPaid}
        destroyOnHidden
      >
        <Form form={payForm} layout="vertical">
          <Form.Item
            name="method"
            label={t("service.paidWith", "Paid with")}
            rules={[{ required: true }]}
          >
            <Select
              aria-label={t("service.paidWith", "Paid with")}
              options={(["TRANSFER", "TRANSFER_LUAR", "TUNAI"] as const).map(
                (p) => ({ value: p, label: paidWord(p) }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="day"
            label={t("service.paidOn", "Paid on")}
            rules={[{ required: true }]}
          >
            <DatePicker format="DD MMM YYYY" style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* The same dialog Stock in → Service opens, with one unit
          (2026-10-30): the courier back, split into the unit's cost or kept
          as the shop's, and what was done. */}
      <ServiceBatchModal
        mode="BACK"
        single
        serials={returning === null ? null : [returning.serial]}
        onClose={() => setReturning(null)}
      />

      {/*
       * Deleting a visit, behind two layers (the draft-opname pattern): this
       * dialog, then the serial typed back. It removes money and history
       * together, and a slip of the wrong row's bin is not undoable.
       */}
      <Modal
        open={deleting !== null}
        title={t(
          "service.deleteVisitTitle",
          "Delete the service visit of {{serial}}?",
          {
            serial: deleting?.serial ?? "",
          },
        )}
        okText={t("service.deleteVisitOk", "Delete the visit")}
        okButtonProps={{
          danger: true,
          disabled: deleteTyped.trim().toUpperCase() !== deleting?.serial,
        }}
        onCancel={() => {
          setDeleting(null);
          setDeleteTyped("");
        }}
        onOk={deleteVisit}
        destroyOnHidden
      >
        <Flex vertical gap={SPACE.sm}>
          <Typography.Paragraph>
            {t(
              "service.deleteVisitBody",
              "Every charge on it ({{amount}}) and any payment recorded for them are deleted, and so are the history rows the visit wrote. {{serial}} goes back to the status and warehouse it had before it was sent.",
              {
                amount: fmtRp(deleting ? visitCost(deleting.rec) : 0),
                serial: deleting?.serial ?? "",
              },
            )}
          </Typography.Paragraph>
          {deleting && instantClosed(deleting.rec.openedAt, db.settings) && (
            <Typography.Text type="danger">
              {t(
                "service.visitInClosedBook",
                "This visit is in a closed book — reopen the book to delete it.",
              )}
            </Typography.Text>
          )}
          <Typography.Text type="secondary">
            {t("service.deleteVisitType", "Type the serial to confirm.")}
          </Typography.Text>
          <Input
            value={deleteTyped}
            onChange={(e) => setDeleteTyped(e.target.value)}
            aria-label={t("service.deleteVisitTypeAria", "Serial, to confirm")}
            placeholder={deleting?.serial}
            autoComplete="off"
            spellCheck={false}
          />
        </Flex>
      </Modal>
    </PageContainer>
  );
}
