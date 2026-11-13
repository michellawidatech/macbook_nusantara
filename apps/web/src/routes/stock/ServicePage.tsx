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
 *
 * ## One button per job (owner ask 2026-11-13)
 *
 * > *"Per row should have a back in stock button … now it is confusing,
 * > redundant, and unclear on which one to click."*
 *
 * - **Every batch row on the bench carries Back in stock**, so bringing a
 *   batch back does not start with opening it.
 * - **The popup has ONE green button**, *Back in stock (n)* at its foot. A
 *   unit's row offers *Add charge* (plain) and its delete (a bin); the row's
 *   own Back in stock, a second green button beside a third, is gone — the
 *   back dialog already asks each unit's cost, and a blank cost stays away.
 * - The batch's name is the popup's heading, typed into in place, with the
 *   date, the route and the unit count under it — the date was in the title
 *   AND the route beside a full-width box.
 * - A batch nobody named shows its units, not "None".
 */
import { ServiceBatchModal } from "../../components/ServiceBatchModal";
import { ServiceChargeModal } from "../../components/ServiceChargeModal";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Statistic,
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
  ToolOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { SerialLink } from "../../components/SerialLink";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { usePaidWithLabel } from "../../components/SendToServiceModal";
import { fmtRp, fmtDate, fmtDateTime, fmtNone } from "../../lib/format.js";
import { serviceBatches, type ServiceBatch } from "../../lib/serviceBatches.js";
import {
  SERVICE_FEE_KINDS,
  benchRows,
  visitCost,
  type BenchRow,
  type ServiceFee,
} from "../../lib/service.js";
import {
  chargeExpense,
  feePayment,
  instantClosed,
  planChargeDeletion,
  planVisitDeletion,
  type PaidWith,
} from "../../lib/serviceActions.js";
import { mutate, nextId, removeEvent, useDb } from "../../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { warehouseLabelOf } from "../../lib/warehouses.js";
import type { MockDb } from "../../mock/seed.js";

/** Out of the draft, so a rule reads the store as the mutation sees it. */
/**
 * Every Back in stock on the bench is one width, whatever its count says
 * (owner ask 2026-11-13: "make the button length more consistent"), and the
 * popup's foot button matches it.
 */
const BACK_BUTTON_WIDTH = 168;
const DETAILS_BUTTON_WIDTH = 88;

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
  /**
   * The units Back in stock is open on — a batch's open units, from its row
   * on the bench or from its popup (one dialog since 2026-11-13; with one
   * unit it lays out as that unit's).
   */
  const [returningBatch, setReturningBatch] = useState<string[] | null>(null);
  /** *Add to service*: the send dialog opened empty, with its list picker. */
  const [adding, setAdding] = useState<string[] | null>(null);
  /** The visits of the batch whose popup is open (ids survive a rename). */
  const [showing, setShowing] = useState<string[] | null>(null);
  /**
   * How long the name in the popup's heading is, so the box is as wide as
   * its words and the pencil sits beside them rather than by the ×.
   */
  const [nameLength, setNameLength] = useState(0);
  /** The visit whose deletion is being confirmed, and what has been typed. */
  const [deleting, setDeleting] = useState<BenchRow | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
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
  // Two tabs since 2026-11-03 (owner list): "In service" and "Service
  // history", where a switch used to fold the finished visits into one list.
  const [tab, setTab] = useState<"OPEN" | "HISTORY">("OPEN");
  const allRows = useMemo(
    () => benchRows(db, Date.now(), { includeClosed: true }),
    [db.services, db.units, db.pos, db.events],
  );
  /** What is away now — what the cards count. */
  const rows = allRows.filter((r) => !r.closed);
  const listed = tab === "OPEN" ? rows : allRows.filter((r) => r.closed);
  /*
   * Grouped into the batches they were sent in (owner ask 2026-11-10): the
   * same instant, from one warehouse, to one warehouse — lib/serviceBatches.
   */
  const batches = useMemo(
    () => serviceBatches(listed, { events: db.events, units: db.units }),
    [listed, db.events, db.units],
  );

  /*
   * The open popup's batch, re-read from every visit (open or finished) so a
   * unit brought back while it is open stays listed, as finished.
   */
  const shown = useMemo(() => {
    if (showing === null) return undefined;
    const mine = allRows.filter((r) => showing.includes(r.rec.id));
    return serviceBatches(mine, { events: db.events, units: db.units }).reduce<
      ServiceBatch | undefined
    >(
      (acc, b) =>
        acc === undefined
          ? b
          : {
              ...acc,
              rows: [...acc.rows, ...b.rows],
              closed: acc.closed && b.closed,
              cost: acc.cost + b.cost,
            },
      undefined,
    );
  }, [showing, allRows, db.events, db.units]);
  const shownOpen = shown ? shown.rows.filter((r) => !r.closed) : [];

  /** The batch's title, written on every one of its visits. */
  const renameBatch = (raw: string) => {
    if (!shown) return;
    const title = raw.trim();
    if (title === (shown.title ?? "")) return;
    const ids = shown.rows.map((r) => r.rec.id);
    void mutate((d) => {
      d.services = d.services.map((v) => {
        if (!ids.includes(v.id)) return v;
        const { title: _old, ...rest } = v;
        return title ? { ...rest, title } : rest;
      });
    });
  };

  const unitOf = (serial: string) => db.units.find((u) => u.serial === serial);
  const skuOf = (serial: string) => {
    const u = unitOf(serial);
    return u && db.skus.find((k) => k.id === u.skuId);
  };
  const warehouseName = (id: string | undefined) =>
    warehouseLabelOf(db.warehouses, id) ?? fmtNone();
  const routeOf = (b: ServiceBatch) =>
    b.fromLocationId === b.toLocationId
      ? t("service.batchStays", "{{name}} (serviced there)", {
          name: warehouseName(b.fromLocationId),
        })
      : `${warehouseName(b.fromLocationId)} → ${warehouseName(b.toLocationId)}`;
  /** A batch nobody named reads as its first unit, and how many more. */
  const unitsLine = (b: ServiceBatch) => {
    const first = b.rows[0];
    if (!first) return fmtNone();
    const sku = skuOf(first.serial);
    const name = sku ? `${sku.name} ${sku.variantLabel}` : first.serial;
    return b.rows.length > 1
      ? t("service.batchUnitsMore", "{{name}} +{{count}} more", {
          name,
          count: b.rows.length - 1,
        })
      : name;
  };

  const totalCost = rows.reduce((n, r) => n + r.cost, 0);

  /*
   * ~~`markArrived`~~ went on 2026-09-25 (owner: *"no need to mark as
   * 'received' first"*). A unit now MOVES to where it is serviced in the same
   * transaction that promises it to a repairer — `SendToServiceModal` writes
   * it — so there is nothing left to confirm.
   */

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
      // One column, its name: the charge dialog asks only the amount and how
      // it was paid (2026-11-13), so a kind beside a label said one thing
      // twice. An older charge with no label still reads as its kind.
      render: (_: unknown, f: ServiceFee) =>
        f.label ??
        SERVICE_FEE_KINDS.find((k) => k.value === f.kind)?.label ??
        f.kind,
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

  return (
    <PageContainer
      title={t("service.title", "Service bench")}
      actions={[
        {
          key: "add",
          label: t("service.addToService", "Add to service"),
          icon: <ToolOutlined />,
          type: "primary",
          onClick: () => setAdding([]),
        },
      ]}
    >
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
          activeTabKey={tab}
          onTabChange={(k) => setTab(k as "OPEN" | "HISTORY")}
          tabList={[
            { key: "OPEN", label: t("service.inService", "In service") },
            {
              key: "HISTORY",
              label: t("service.history", "Service history"),
            },
          ]}
        >
          <Table<ServiceBatch>
            size="small"
            rowKey="key"
            dataSource={batches}
            pagination={false}
            locale={{
              emptyText:
                tab === "OPEN"
                  ? t("service.nothingAway", "Nothing is away at a repairer.")
                  : t("service.noHistory", "No finished service visits yet."),
            }}
            /*
             * A batch away opens straight into Back in stock, the caret in
             * the first cost box (owner 2026-11-13: "they can open that,
             * immediately start typing, done"). Its charges, its name and
             * deleting a visit are behind the row's Details. A finished
             * batch has nothing to bring back and opens its details.
             */
            onRow={(b) => ({
              onClick: () => {
                const open = b.rows.filter((r) => !r.closed);
                if (tab === "OPEN" && open.length > 0)
                  setReturningBatch(open.map((r) => r.serial));
                else setShowing(b.rows.map((r) => r.rec.id));
              },
              "data-serials": b.rows.map((r) => r.serial).join(" "),
              style: { cursor: "pointer" },
            })}
            columns={[
              {
                title: t("service.batchTitle", "Batch name"),
                key: "title",
                // The name when somebody gave one, and always what is in it —
                // a column of "None" told nobody which batch was which.
                render: (_, b) => (
                  <Flex vertical gap={0}>
                    {b.title && (
                      <Typography.Text strong>{b.title}</Typography.Text>
                    )}
                    <Typography.Text
                      type={b.title ? "secondary" : undefined}
                      style={b.title ? { fontSize: TYPE.sm } : undefined}
                    >
                      {unitsLine(b)}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("service.batchSent", "Sent"),
                key: "at",
                width: 170,
                render: (_, b) => fmtDateTime(b.openedAt),
              },
              {
                title: t("service.batchRoute", "From → to"),
                key: "route",
                render: (_, b) => routeOf(b),
              },
              {
                title: t("service.batchUnits", "Units"),
                key: "n",
                width: COLUMN.qty,
                align: "right",
                render: (_, b) => b.rows.length,
              },
              {
                title: t("service.charges", "Charges"),
                key: "cost",
                width: COLUMN.money,
                align: "right",
                render: (_, b) => fmtRp(b.cost),
              },
              /*
               * Back in stock on the row itself (owner ask 2026-11-13: "per
               * row should have a back in stock button, not just when you
               * click it"). It opens the same dialog the popup's does.
               */
              ...(tab === "OPEN"
                ? [
                    {
                      title: "",
                      key: "back",
                      width: BACK_BUTTON_WIDTH + DETAILS_BUTTON_WIDTH + 24,
                      align: "right" as const,
                      render: (_: unknown, b: ServiceBatch) => {
                        const open = b.rows.filter((r) => !r.closed);
                        if (open.length === 0) return null;
                        return (
                          <Flex gap={SPACE.xs} justify="end">
                            <Button
                              size="small"
                              style={{ width: DETAILS_BUTTON_WIDTH }}
                              aria-label={t(
                                "service.batchDetailsAria",
                                "Details of the batch holding {{serial}}",
                                { serial: b.rows[0]?.serial ?? "" },
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowing(b.rows.map((r) => r.rec.id));
                              }}
                            >
                              {t("service.batchDetails", "Details")}
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              icon={<InboxOutlined />}
                              style={{ width: BACK_BUTTON_WIDTH }}
                              aria-label={
                                open.length === 1
                                  ? t(
                                      "service.sendBackAria",
                                      "Put {{serial}} back in stock",
                                      { serial: open[0]!.serial },
                                    )
                                  : undefined
                              }
                              onClick={(e) => {
                                // The row opens the popup; this is not that.
                                e.stopPropagation();
                                setReturningBatch(open.map((r) => r.serial));
                              }}
                            >
                              {t(
                                "service.batchBack",
                                "Back in stock ({{count}})",
                                { count: open.length },
                              )}
                            </Button>
                          </Flex>
                        );
                      },
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      </Flex>

      {/*
       * One batch, every unit in it (owner ask 2026-11-11). Its title is
       * edited here and written on every visit of the batch; *Back in stock*
       * opens the back dialog with all of the batch's open units, which asks
       * each one's repair cost and brings back the ones that have one.
       */}
      <Modal
        open={shown !== undefined}
        width={960}
        centered
        title={
          shown && (
            <Flex vertical gap={2} style={{ paddingInlineEnd: SPACE.lg }}>
              {/*
               * The name IS the heading, typed into in place (2026-11-13) —
               * it was a full-width box under a title that repeated the date.
               */}
              <Input
                key={shown.rows[0]?.rec.id}
                ref={(el) => {
                  const v = el?.input?.value;
                  if (v !== undefined && v.length !== nameLength)
                    setNameLength(v.length);
                }}
                onChange={(e) => setNameLength(e.target.value.length)}
                variant="borderless"
                aria-label={t("service.batchTitle", "Batch name")}
                defaultValue={shown.title ?? ""}
                placeholder={t("service.batchNameIt", "Name this batch")}
                maxLength={80}
                suffix={
                  <EditOutlined
                    aria-hidden
                    style={{ color: "var(--ant-color-text-tertiary)" }}
                  />
                }
                style={{
                  paddingInline: 0,
                  width: `calc(${Math.max(nameLength, 16) + 1}ch + 28px)`,
                  maxWidth: "100%",
                }}
                styles={{ input: { fontSize: TYPE.lg, fontWeight: 600 } }}
                onBlur={(e) => renameBatch(e.target.value)}
                onPressEnter={(e) => renameBatch(e.currentTarget.value)}
              />
              <Typography.Text
                type="secondary"
                style={{ fontSize: TYPE.sm, fontWeight: 400 }}
              >
                {[
                  t("service.batchSentOn", "Sent {{when}}", {
                    when: fmtDateTime(shown.openedAt),
                  }),
                  routeOf(shown),
                  t("service.batchUnitCount", "{{count}} unit(s)", {
                    count: shown.rows.length,
                  }),
                ].join(" · ")}
              </Typography.Text>
            </Flex>
          )
        }
        onCancel={() => setShowing(null)}
        // The popup's ONE green button (2026-11-13). The × closes it.
        footer={
          shownOpen.length > 0 ? (
            <Button
              type="primary"
              icon={<InboxOutlined />}
              style={{ minWidth: BACK_BUTTON_WIDTH }}
              onClick={() => setReturningBatch(shownOpen.map((r) => r.serial))}
            >
              {t("service.batchBack", "Back in stock ({{count}})", {
                count: shownOpen.length,
              })}
            </Button>
          ) : null
        }
        destroyOnHidden
      >
        {shown && (
          <Table<BenchRow>
            size="small"
            rowKey={(r) => r.rec.id}
            dataSource={[...shown.rows]}
            // A finished visit is listed to be deleted, and reads as history.
            onRow={(r) => (r.closed ? { style: { opacity: 0.55 } } : {})}
            pagination={false}
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
                title: t("service.unit", "Unit"),
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
                /*
                 * What the repair has cost so far — the fees on THIS visit,
                 * paid or owed, and how much of it is still owed. The lines
                 * behind the row say what it is made of, and are where one
                 * of them is corrected.
                 */
                title: t("service.charges", "Charges"),
                key: "cost",
                width: COLUMN.money + 24,
                align: "right",
                render: (_, r) => {
                  const owed = r.rec.fees
                    .filter((f) => !feePayment(f, db.expenses).paid)
                    .reduce((n, f) => n + f.amount, 0);
                  return (
                    <Flex vertical gap={0} align="flex-end">
                      <span>{fmtRp(r.cost)}</span>
                      {owed > 0 && (
                        <Typography.Text
                          type="warning"
                          style={{ fontSize: TYPE.sm }}
                        >
                          {t("service.owedPart", "{{amount}} not paid", {
                            amount: fmtRp(owed),
                          })}
                        </Typography.Text>
                      )}
                    </Flex>
                  );
                },
              },
              {
                /*
                 * One plain button and a bin (2026-11-13). Back in stock is
                 * the footer's, for the whole batch — a second green button
                 * on every row beside a third was what made the popup
                 * unclear.
                 */
                title: "",
                key: "actions",
                width: COLUMN.actionsWide,
                render: (_, r) => (
                  <Flex gap={SPACE.xs} justify="end" align="center">
                    {r.closed ? (
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {t("service.finished", "Finished {{when}}", {
                          when: fmtDate(r.rec.closedAt!),
                        })}
                      </Tag>
                    ) : (
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        aria-label={t(
                          "service.addFeeAria",
                          "Add a charge to {{serial}}",
                          { serial: r.serial },
                        )}
                        onClick={() => {
                          setAddingTo(r);
                        }}
                      >
                        {t("service.addCharge", "Add charge")}
                      </Button>
                    )}
                    <Tooltip
                      title={t("service.deleteVisit", "Delete this visit")}
                    >
                      <Button
                        size="small"
                        type="text"
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
        )}
      </Modal>

      <ServiceChargeModal
        zIndex={1100}
        target={
          editingFee
            ? {
                visitId: editingFee.row.rec.id,
                serial: editingFee.row.serial,
                fee: editingFee.fee,
              }
            : addingTo
              ? { visitId: addingTo.rec.id, serial: addingTo.serial }
              : null
        }
        onClose={() => {
          setAddingTo(null);
          setEditingFee(null);
        }}
      />

      <Modal
        open={payingFee !== null}
        zIndex={1100}
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

      {/* Back in stock, from a batch's row or its popup: each open unit's
          cost with Fill down, how it was paid, where it goes, and the courier
          back when it travels (2026-11-13). One unit lays out as that unit's. */}
      <ServiceBatchModal
        mode="BACK"
        single
        fixed
        zIndex={1100}
        serials={returningBatch}
        onClose={() => setReturningBatch(null)}
      />
      {/* Add to service (2026-11-10): any unit on a shelf or in QC, typed,
          scanned or chosen from the list, sent as one batch. */}
      <ServiceBatchModal
        mode="SEND"
        serials={adding}
        onClose={() => setAdding(null)}
      />

      {/*
       * Deleting a visit, behind two layers (the draft-opname pattern): this
       * dialog, then the serial typed back. It removes money and history
       * together, and a slip of the wrong row's bin is not undoable.
       */}
      <Modal
        open={deleting !== null}
        zIndex={1100}
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
