/**
 * Every return, both directions, in one table (owner ask 2026-09-23).
 *
 * > *"I think you can just combine the table (so it is 1 table for all from
 * > customer and to supplier), but add the 'Type' which are 'to supplier' and
 * > 'from customer', date, associated transaction/inbound … only display
 * > transaction number/inbound, date, supplier/customer, reason, and when the
 * > row is clicked, it will show a popup of all the unit."*
 *
 * Two tables of the same document, differing in which way the unit travelled,
 * was two vocabularies for one job. The columns are the five facts common to
 * both; everything per unit is behind the row, which is the shape Inventory
 * already uses for the units behind a line.
 *
 * A row is one press of Record return. Customer returns group by the instant
 * their `RETUR` adjustments share — a press can touch several sales — falling
 * back to the exchange they were part of and then to their own code, which is
 * also how a B2Soft document's lines arrive. A supplier return is one row per
 * document, and a counted product's return is a `RETUR_SUPPLIER` stock move
 * with no return row at all.
 */
import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  App,
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import { SerialLink } from "../../components/SerialLink";
import { GradeTag } from "../../components/GradeTag";
import { fmtDate, fmtNone } from "../../lib/format.js";
import { saleOfReturn } from "../../lib/returns.js";
import {
  applyReturnEdit,
  canUndoReturn,
  enteredPayments,
  type UndoCheck,
} from "../../lib/returnUndo.js";
import { billAfterReturns, withOwed } from "../../lib/salePayments.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

/** The grades a corrected condition may be set to — the QC vocabulary. */
const GRADE_OPTIONS: readonly string[] = ["NEW", "A", "B", "C"];

/** A row is a control; its buttons must not open the units popup as well. */
const stop = (e: MouseEvent) => e.stopPropagation();

type Side = "CUSTOMER" | "SUPPLIER";

/** One unit — or one quantity of a counted product — inside a return. */
interface ReturnLine {
  readonly key: string;
  readonly product: string;
  /** Absent on a counted product: there is no serial to show. */
  readonly serial?: string;
  /** The grade it is recorded at. Absent on a counted product. */
  readonly grade?: string;
  /** Pieces, on a counted product. */
  readonly qty?: number;
}

interface HistoryRow {
  readonly key: string;
  readonly side: Side;
  /** The sale's SI code, or the invoice the units came in on. */
  readonly documents: readonly string[];
  /** The return's own SG codes. */
  readonly codes: readonly string[];
  readonly date: string;
  readonly party: string;
  readonly reason: string;
  readonly reasonOnly: string;
  readonly reasonDetail: string;
  readonly lines: readonly ReturnLine[];
  /**
   * The `ReturnRec` ids behind the row, and the counted moves beside them.
   * A row is one PRESS of Record return, so both are lists — the edit and the
   * undo act on every document of that press together, exactly as the press
   * wrote them together.
   */
  readonly recIds: readonly string[];
  readonly moveIds: readonly string[];
  /** Every document of the row is already withdrawn. */
  readonly cancelled: boolean;
}

export function ReturnHistoryTable() {
  const { t } = useTranslation();
  const db = useDb();
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState<HistoryRow | null>(null);
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [form] = Form.useForm<{
    date: dayjs.Dayjs;
    reason: string;
    reasonDetail?: string;
    grades?: Record<string, string>;
  }>();

  const sideLabel = (s: Side) =>
    s === "CUSTOMER"
      ? t("returns.fromCustomer", "From customer")
      : t("returns.toSupplier", "To supplier");

  const rows = useMemo<HistoryRow[]>(() => {
    const skus = new Map(db.skus.map((k) => [k.id, k]));
    const units = new Map(db.units.map((u) => [u.serial, u]));
    const skuName = (id: string | undefined) => {
      const sku = id === undefined ? undefined : skus.get(id);
      return sku ? `${sku.name} ${sku.variantLabel}` : fmtNone();
    };
    /** The row while it is being built: the arrays are still growing. */
    interface Draft {
      key: string;
      side: Side;
      documents: string[];
      codes: string[];
      date: string;
      party: string;
      reason: string;
      reasonOnly: string;
      reasonDetail: string;
      lines: ReturnLine[];
      recIds: string[];
      moveIds: string[];
      live: number;
    }
    const groups = new Map<string, Draft>();
    const rowFor = (
      key: string,
      seed: Omit<
        Draft,
        "key" | "documents" | "codes" | "lines" | "recIds" | "moveIds" | "live"
      >,
    ): Draft => {
      let row = groups.get(key);
      if (row === undefined) {
        row = {
          key,
          ...seed,
          documents: [],
          codes: [],
          lines: [],
          recIds: [],
          moveIds: [],
          live: 0,
        };
        groups.set(key, row);
      }
      return row;
    };
    const note = (row: Draft, document: string | undefined, code: string) => {
      if (document !== undefined && !row.documents.includes(document))
        row.documents.push(document);
      if (!row.codes.includes(code)) row.codes.push(code);
    };

    for (const r of db.returns) {
      const unit = units.get(r.serial);
      if (r.kind === "CUSTOMER") {
        const sale = saleOfReturn(db.orders, r);
        const adj = sale?.adjustments?.find(
          (a) => a.type === "RETUR" && a.code === r.code,
        );
        const key = adj
          ? `at:${adj.at}`
          : r.exchangeSerial
            ? `ex:${r.exchangeSerial}`
            : `code:${r.code}`;
        const customer =
          sale?.customerId == null
            ? t("piutang.walkIn", "Walk-in")
            : (db.customers.find((c) => c.id === sale.customerId)?.name ??
              t("piutang.walkIn", "Walk-in"));
        const row = rowFor(key, {
          side: "CUSTOMER",
          date: r.date,
          party: customer,
          reason: [r.reason, r.reasonDetail].filter(Boolean).join(": "),
          reasonOnly: r.reason,
          reasonDetail: r.reasonDetail ?? "",
        });
        note(row, sale?.code, r.code);
        row.recIds.push(r.id);
        if (r.status !== "CANCELLED") row.live += 1;
        row.lines.push({
          key: r.id,
          product: skuName(unit?.skuId),
          serial: r.serial,
          ...((r.afterGrade ?? unit?.grade)
            ? { grade: r.afterGrade ?? unit?.grade }
            : {}),
        });
        continue;
      }
      const po = db.pos.find((p) => p.items.some((i) => i.serial === r.serial));
      const row = rowFor(`sup:${r.code}`, {
        side: "SUPPLIER",
        date: r.date,
        party:
          db.suppliers.find((x) => x.id === r.supplierId)?.name ??
          t("utang.noSupplier", "No supplier named"),
        reason: [r.reason, r.reasonDetail].filter(Boolean).join(": "),
        reasonOnly: r.reason,
        reasonDetail: r.reasonDetail ?? "",
      });
      note(row, po?.code, r.code);
      row.recIds.push(r.id);
      if (r.status !== "CANCELLED") row.live += 1;
      row.lines.push({
        key: r.id,
        product: skuName(unit?.skuId),
        serial: r.serial,
        ...(unit?.grade ? { grade: unit.grade } : {}),
      });
    }

    // Counted products move on the ledger and have no return row of their own.
    for (const m of db.stockMoves) {
      if (m.type !== "RETUR_PELANGGAN" && m.type !== "RETUR_SUPPLIER") continue;
      const code = m.refCode ?? m.id;
      const customerSide = m.type === "RETUR_PELANGGAN";
      const sale =
        m.orderId === undefined
          ? undefined
          : db.orders.find((o) => o.id === m.orderId);
      const adj = sale?.adjustments?.find(
        (a) => a.type === "RETUR" && a.code === code,
      );
      const po =
        m.poId === undefined ? undefined : db.pos.find((p) => p.id === m.poId);
      const key = customerSide
        ? adj
          ? `at:${adj.at}`
          : `code:${code}`
        : `sup:${code}`;
      const row = rowFor(key, {
        side: customerSide ? "CUSTOMER" : "SUPPLIER",
        date: m.at,
        party: customerSide
          ? sale?.customerId == null
            ? t("piutang.walkIn", "Walk-in")
            : (db.customers.find((c) => c.id === sale.customerId)?.name ??
              t("piutang.walkIn", "Walk-in"))
          : (db.suppliers.find((x) => x.id === po?.supplierId)?.name ??
            t("utang.noSupplier", "No supplier named")),
        reason:
          db.reasons.find((r) => r.id === m.reasonId)?.label ?? m.note ?? "",
        reasonOnly:
          db.reasons.find((r) => r.id === m.reasonId)?.label ?? m.note ?? "",
        reasonDetail: "",
      });
      note(row, customerSide ? sale?.code : po?.code, code);
      row.moveIds.push(m.id);
      row.lines.push({
        key: m.id,
        product: skuName(m.skuId),
        qty: Math.abs(m.qty),
      });
    }

    return [...groups.values()]
      .map(({ live, ...r }) => ({
        ...r,
        // A row of nothing but withdrawn documents. Counted moves have no
        // status of their own, so a row that is only moves is never cancelled.
        cancelled: r.recIds.length > 0 && live === 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [
    db.returns,
    db.stockMoves,
    db.orders,
    db.pos,
    db.units,
    db.skus,
    db.customers,
    db.suppliers,
    db.reasons,
    t,
  ]);

  /**
   * May this row be taken back, and why not?
   *
   * The rule is `lib/returnUndo.ts`; this only gathers what it reads. The
   * sales are found through the row's own RETUR codes rather than through
   * `saleOfReturn`, because one press can credit several sales and all of
   * them have to pass.
   */
  const undoCheck = (r: HistoryRow): UndoCheck => {
    const recs = db.returns.filter((x) => r.recIds.includes(x.id));
    const codes = new Set(r.codes);
    const sales = db.orders.filter((o) =>
      (o.adjustments ?? []).some(
        (a) => a.type === "RETUR" && a.code !== undefined && codes.has(a.code),
      ),
    );
    return canUndoReturn({
      recs,
      sales,
      units: new Map(db.units.map((u) => [u.serial, u])),
      settings: db.settings,
      countedCodes: r.moveIds,
    });
  };

  const undoTitle = (check: UndoCheck) =>
    check.ok
      ? t("returns.undoReturn", "Take this return back")
      : {
          ALREADY_CANCELLED: t(
            "returns.undoDoneAlready",
            "This return has already been taken back.",
          ),
          UNIT_MOVED: t(
            "returns.undoUnitMoved",
            "A unit on this return has been sold, held or moved since. Undo it where it is now.",
          ),
          MARKETPLACE: t(
            "returns.undoMarketplace",
            "This return cancelled money a marketplace was holding, and nothing records how much came off which part. Correct the sale's payments instead.",
          ),
          EXCHANGE: t(
            "returns.undoExchange",
            "This return was an exchange. The customer's money moved to another sale, so it cannot be put back automatically.",
          ),
          BOOKS_CLOSED: t(
            "returns.undoBooksClosed",
            "The sale is in a closed period. Reopen the book first.",
          ),
        }[check.why];

  const openEdit = (r: HistoryRow) => {
    setEditing(r);
    form.setFieldsValue({
      date: dayjs(r.date),
      reason: r.reasonOnly,
      reasonDetail: r.reasonDetail,
      grades: Object.fromEntries(
        r.lines
          .filter((l) => l.serial !== undefined && l.grade !== undefined)
          .map((l) => [l.serial!, l.grade!]),
      ),
    });
  };

  /**
   * Correct a return's own facts — when, why, and what condition each unit
   * was recorded at (owner ask 2026-09-25).
   *
   * Deliberately NOT which units came back or what they were worth: those two
   * are what the money was computed from, so changing one of them is a take-
   * back and a fresh return, not an edit. A corrected condition follows onto
   * the unit itself in the same mutation, the way `applyStockHistoryEdit`
   * carries a corrected reading.
   */
  const saveEdit = () =>
    form.validateFields().then((v) => {
      const row = editing!;
      const date = v.date.toISOString();
      const edit = {
        date,
        reason: v.reason,
        ...(v.reasonDetail ? { reasonDetail: v.reasonDetail } : {}),
        ...(v.grades ? { grades: v.grades } : {}),
      };
      mutate((d) => {
        for (const id of row.recIds) {
          const i = d.returns.findIndex((x) => x.id === id);
          if (i < 0) continue;
          const was = d.returns[i]!;
          d.returns[i] = applyReturnEdit(was, edit) as typeof was;
          const grade = v.grades?.[was.serial];
          // The unit follows the correction only while it still says what
          // this return recorded — a later regrade is somebody else's answer.
          if (grade !== undefined && grade !== was.afterGrade) {
            const u = d.units.find((x) => x.serial === was.serial);
            if (u && u.grade === was.afterGrade) {
              u.grade = grade as typeof u.grade;
              appendEvent(d, was.serial, {
                type: "KOREKSI",
                refCode: was.code,
                note: `Return condition corrected ${was.afterGrade ?? "?"} → ${grade}`,
              });
            }
          }
        }
        // A counted line has no ReturnRec; its move carries the note.
        for (const id of row.moveIds) {
          const i = d.stockMoves.findIndex((x) => x.id === id);
          if (i >= 0) d.stockMoves[i] = { ...d.stockMoves[i]!, note: v.reason };
        }
      });
      setEditing(null);
      message.success(t("returns.editSaved", "The return is corrected."));
    });

  /**
   * Take a return back.
   *
   * One mutation, because it is one decision: every document of the press is
   * withdrawn, every unit goes back to where the return found it, the sales'
   * RETUR adjustments go so the bill rises again, and the derived debt row is
   * rebuilt from that bill. What is NOT touched is the refund and its Income
   * & Expense line — see `lib/returnUndo.ts` on why money that left the
   * drawer stays recorded as having left.
   */
  const undo = (r: HistoryRow) => {
    const codes = new Set(r.codes);
    mutate((d) => {
      const staff = currentStaffName();
      for (const id of r.recIds) {
        const i = d.returns.findIndex((x) => x.id === id);
        if (i < 0) continue;
        const rec = d.returns[i]!;
        if (rec.status === "CANCELLED") continue;
        d.returns[i] = { ...rec, status: "CANCELLED" };
        const u = d.units.find((x) => x.serial === rec.serial);
        if (u === undefined) continue;
        if (rec.kind === "CUSTOMER") {
          // Back out to the customer it was sold to, at the grade it went out
          // at. `beforeGrade` is the snapshot the return took for exactly
          // this; without one the current grade is the best that is known.
          if (rec.beforeGrade) u.grade = rec.beforeGrade as typeof u.grade;
          appendEvent(d, rec.serial, {
            type: "KOREKSI",
            toStatus: "TERJUAL",
            refCode: rec.code,
            note: `Return ${rec.code} taken back — ${staff}`,
          });
        } else {
          appendEvent(d, rec.serial, {
            type: "KOREKSI",
            toStatus: "TERSEDIA",
            toLocationId: d.myWarehouseId,
            refCode: rec.code,
            note: `Supplier return ${rec.code} withdrawn — ${staff}`,
          });
        }
      }

      // Counted pieces: the ledger is append-only, so the reversal is another
      // move rather than the removal of the one the return wrote.
      for (const id of r.moveIds) {
        const m = d.stockMoves.find((x) => x.id === id);
        if (m === undefined) continue;
        d.stockMoves.push({
          ...m,
          id: nextId("sm"),
          qty: -m.qty,
          type: "KOREKSI",
          at: new Date().toISOString(),
          note: `Return ${m.refCode ?? m.id} taken back`,
          staff,
        });
        if (m.orderLineId !== undefined) {
          const order = d.orders.find((o) => o.id === m.orderId);
          const line = order?.lines?.find((l) => l.id === m.orderLineId);
          if (line)
            line.returnedQty = Math.max(
              0,
              (line.returnedQty ?? 0) - Math.abs(m.qty),
            );
        }
      }

      for (const order of d.orders) {
        const mine = (order.adjustments ?? []).filter(
          (a) =>
            a.type === "RETUR" && a.code !== undefined && codes.has(a.code),
        );
        if (mine.length === 0) continue;
        order.adjustments = (order.adjustments ?? []).filter(
          (a) =>
            !(a.type === "RETUR" && a.code !== undefined && codes.has(a.code)),
        );
        /*
         * The bill is back up, so the shortfall has to be derived again: the
         * DUE row `withOwed` wrote was computed from the SMALLER bill, and
         * keeping it would leave the customer owing the returned amount less
         * than they do.
         */
        const bill = billAfterReturns(order);
        const entered = enteredPayments(order.id, order.payments ?? []);
        order.payments = withOwed(order.id, bill, entered);
        order.settled = order.payments.every((p) => p.state === "SETTLED");
      }
    });
    message.success(
      t("returns.undone", "{{code}} is taken back.", {
        code: r.codes.join(", "),
      }),
    );
  };

  const confirmUndo = (r: HistoryRow) =>
    modal.confirm({
      title: t("returns.undoTitle", "Take this return back?"),
      okText: t("returns.undoOk", "Take it back"),
      okButtonProps: { danger: true },
      content: t(
        "returns.undoBody",
        "{{code}} stays in the history, marked withdrawn, and every unit on it goes back to where the return found it. The sale owes the returned amount again. Money already handed back stays recorded as handed back — collect it or correct the payments yourself.",
        { code: r.codes.join(", ") },
      ),
      onOk: () => undo(r),
    });

  return (
    <>
      <ProTable<HistoryRow>
        persistKey="returns.history"
        rowKey="key"
        dataSource={rows}
        searchPlaceholder={t(
          "returns.searchHistory",
          "Search a transaction, an invoice, a name or a reason",
        )}
        onRow={(r) => ({
          onClick: () => setOpen(r),
          style: { cursor: "pointer" },
        })}
        keyboardRows={(r) => r.codes.join(", ")}
        columns={[
          {
            title: t("returns.type", "Type"),
            key: "side",
            width: COLUMN.status,
            facet: true,
            facetLabel: t("returns.type", "Type"),
            facetValue: (r) => sideLabel(r.side),
            sortValue: (r) => sideLabel(r.side),
            render: (_, r) => (
              <Tag color={r.side === "CUSTOMER" ? "purple" : "blue"}>
                {sideLabel(r.side)}
              </Tag>
            ),
          },
          {
            title: t("returns.document", "Transaction / inbound"),
            key: "document",
            width: COLUMN.code,
            searchable: true,
            searchValue: (r) => [...r.documents, ...r.codes].join(" "),
            sortValue: (r) => r.documents[0] ?? "",
            render: (_, r) => (
              <Flex vertical gap={0}>
                <Typography.Text strong>
                  {r.documents.length === 0
                    ? fmtNone()
                    : r.documents.join(", ")}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: TYPE.sm, fontFamily: "monospace" }}
                >
                  {r.codes.join(", ")}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("returns.date", "Date"),
            key: "date",
            width: COLUMN.date,
            defaultSortOrder: "descend",
            dateRange: true,
            facetLabel: t("returns.date", "Date"),
            sortValue: (r) => r.date,
            render: (_, r) => fmtDate(r.date),
          },
          {
            title: t("returns.party", "Supplier / customer"),
            key: "party",
            width: COLUMN.code,
            searchable: true,
            searchValue: (r) => r.party,
            sortValue: (r) => r.party,
            render: (_, r) => r.party,
          },
          {
            title: t("returns.reason", "Reason"),
            key: "reason",
            searchable: true,
            searchValue: (r) => r.reason,
            sortValue: (r) => r.reason,
            render: (_, r) => (
              <Flex vertical gap={0}>
                <Typography.Text>{r.reason || fmtNone()}</Typography.Text>
                {r.cancelled && (
                  <Tag color="default" style={{ marginTop: 2 }}>
                    {t("returns.withdrawn", "Withdrawn")}
                  </Tag>
                )}
              </Flex>
            ),
          },
          {
            /*
             * Correcting a return, and taking one back (owner ask
             * 2026-09-25). Both stop the click that opens the units — the
             * row is a control and so are these, and a dialog opening behind
             * a dialog is what `stopPropagation` is for.
             */
            title: "",
            key: "actions",
            width: COLUMN.actionsPair,
            render: (_, r) => {
              const check = undoCheck(r);
              return (
                <Flex gap={SPACE.xs} justify="end" onClick={stop}>
                  {/*
                   * Both carry their word, not just their glyph (owner ask
                   * 2026-09-25). A pencil and a bin beside each other on a
                   * row that can also be opened were two unlabelled guesses
                   * about what the row was going to do to a document the
                   * shop's money was computed from.
                   */}
                  <Tooltip title={t("returns.editReturn", "Correct it")}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<EditOutlined />}
                      disabled={r.cancelled || r.recIds.length === 0}
                      aria-label={t(
                        "returns.editReturnAria",
                        "Correct return {{code}}",
                        { code: r.codes.join(", ") },
                      )}
                      onClick={() => openEdit(r)}
                    >
                      {t("common.edit", "Edit")}
                    </Button>
                  </Tooltip>
                  <Tooltip title={undoTitle(check)}>
                    <span>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!check.ok}
                        aria-label={t(
                          "returns.undoReturnAria",
                          "Take return {{code}} back",
                          { code: r.codes.join(", ") },
                        )}
                        onClick={() => confirmUndo(r)}
                      >
                        {t("common.delete", "Delete")}
                      </Button>
                    </span>
                  </Tooltip>
                </Flex>
              );
            },
          },
        ]}
      />

      {/*
       * Correcting a return (owner ask 2026-09-25).
       *
       * Three questions and no more: when it happened, why, and what
       * condition each unit was recorded at. Which units came back and what
       * they were worth are not here on purpose — they are what the money was
       * computed from, and changing one of them is a take-back and a fresh
       * return.
       */}
      <Modal
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText={t("returns.saveEdit", "Save the correction")}
        destroyOnHidden
        width={560}
        title={t("returns.editTitle", "Correct {{code}}", {
          code: editing?.codes.join(", ") ?? "",
        })}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="date"
            label={t("returns.date", "Date")}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="reason"
            label={t("returns.reason", "Reason")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              options={db.reasons
                .filter(
                  (x) =>
                    x.active &&
                    x.activity ===
                      (editing?.side === "CUSTOMER"
                        ? "RETURN_CUSTOMER"
                        : "RETURN_SUPPLIER"),
                )
                .map((x) => ({ value: x.label, label: x.label }))}
            />
          </Form.Item>
          <Form.Item
            name="reasonDetail"
            label={t("returns.reasonDetail", "More about it")}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          {(editing?.lines ?? [])
            .filter((l) => l.serial !== undefined)
            .map((l) => (
              <Form.Item
                key={l.key}
                name={["grades", l.serial!]}
                label={t("returns.conditionOf", "Condition of {{serial}}", {
                  serial: l.serial,
                })}
              >
                <Select
                  allowClear
                  options={GRADE_OPTIONS.map((g) => ({ value: g, label: g }))}
                />
              </Form.Item>
            ))}
        </Form>
      </Modal>

      <Modal
        open={open !== null}
        onCancel={() => setOpen(null)}
        footer={null}
        width={720}
        title={
          open && (
            <Flex vertical gap={2}>
              <span>{open.codes.join(", ")}</span>
              <Typography.Text
                type="secondary"
                style={{ fontSize: TYPE.sm, fontWeight: 400 }}
              >
                {[sideLabel(open.side), open.party, fmtDate(open.date)].join(
                  " · ",
                )}
              </Typography.Text>
            </Flex>
          )
        }
      >
        <Table<ReturnLine>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={open?.lines ?? []}
          columns={[
            {
              title: t("returns.product", "Product"),
              key: "product",
              render: (_, l) => (
                <Flex vertical gap={0}>
                  <Typography.Text>{l.product}</Typography.Text>
                  {l.qty !== undefined && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      ×{l.qty}
                    </Typography.Text>
                  )}
                </Flex>
              ),
            },
            {
              title: t("returns.serial", "Serial number"),
              key: "serial",
              width: COLUMN.serial,
              render: (_, l) =>
                l.serial === undefined ? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ) : (
                  <SerialLink serial={l.serial} />
                ),
            },
            {
              title: t("returns.condition", "Condition"),
              key: "grade",
              width: COLUMN.grade,
              render: (_, l) =>
                // A counted product has no condition — it is a quantity.
                l.serial === undefined || l.grade === undefined ? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ) : (
                  <GradeTag grade={l.grade} />
                ),
            },
          ]}
        />
        <Typography.Text
          type="secondary"
          style={{ fontSize: TYPE.sm, display: "block", marginTop: SPACE.sm }}
        >
          {open?.reason}
        </Typography.Text>
      </Modal>
    </>
  );
}
