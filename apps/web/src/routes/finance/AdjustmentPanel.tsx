/**
 * Adjustments — money moved by hand, in either direction.
 *
 * ## Why this replaced "Add expense" (owner ask 2026-09-01)
 *
 * The page could only ever record money going OUT. Money coming in was
 * derived from sales, which is right for a shop that sells everything through
 * its own till and wrong for this one: takings from before the app existed, a
 * machine sold off-app, a float topped up from the owner's account. None of
 * those is a sale — inventing an `Order` to hold one would put a receipt in
 * Transaction History for a transaction that never happened, with serials on
 * it that do not exist — and none of them could be recorded at all.
 *
 * So the button is *Add adjustment* and the dialog asks the direction first.
 * The rest of the form is the same five questions either way; only the reason
 * list changes, because "Payroll" is not a way for money to arrive and
 * "Account transfer" is not a way for it to leave.
 *
 * ## A modal, not a drawer (owner ask 2026-09-01)
 *
 * It was a right-hand drawer. Six short fields is not a side panel's worth of
 * form, and a drawer slides the page out of the way to show them — which is
 * the wrong gesture for a dialog you open, fill and dismiss without needing
 * anything behind it.
 *
 * ## Where the money lands
 *
 * An expense adjustment writes an `Expense`, exactly as before, so the
 * marketing scorecard above keeps reading the same rows. An income adjustment
 * writes a `ManualIncome` — a separate list, because it genuinely is a
 * different thing. ⚠️ Mock-only: prisma has neither a manual-income table nor
 * a nullable `Expense.label`.
 */
import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { ProTable } from "../../components/ProTable";
import { LongText } from "../../components/LongText";
import { MoneyInput } from "../../components/MoneyInput";
import { useTranslation } from "react-i18next";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import {
  EXPENSE_CATEGORIES,
  INCOME_REASONS,
  type ExpenseKind,
  type IncomeReason,
} from "../../mock/seed.js";
import { labelOf } from "../../i18n/enumLabels.js";
import { ADJUSTMENT_METHOD_CODES } from "../../lib/accounts.js";
import { COLUMN } from "../../theme/tokens";

/** Derived, not duplicated: `seed.ts` stays the one list of categories. */
const EXPENSE_KIND: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
);
const INCOME_REASON: Record<string, string> = Object.fromEntries(
  INCOME_REASONS.map((r) => [r.value, r.label]),
);

/**
 * Which way the money went. The first question the dialog asks.
 *
 * `MOVE` (owner ask 2026-10-22): money moved between the shop's own two pots —
 * *"take 2mil in bank to cash, use the cash, and return the money again"*.
 * Neither income nor expense of the business, so it is a third answer; it is
 * written as the pair the ledger already has words for — an "Bank transfer"
 * expense out of one pot and an "Account transfer" income into the other, in
 * one save — so each balance moves and the total does not.
 */
type Direction = "INCOME" | "EXPENSE" | "MOVE";

/** The two moves, by the names the shop uses for them. */
const MOVES = [
  { value: "BANK_TO_CASH", from: "TRANSFER", to: "TUNAI" },
  { value: "CASH_TO_BANK", from: "TUNAI", to: "TRANSFER" },
] as const;

interface Values {
  direction: Direction;
  reason: string;
  date: Dayjs;
  amount: number;
  /** A `PaymentMethod` code. See `method` on the form below. */
  method: string;
  note?: string;
  referralSourceId?: string;
  /** The receipt this is about, where the category needs one. */
  orderId?: string;
}

/** One row of the history table, from either list. */
interface Row {
  key: string;
  direction: Direction;
  /** The reason, spelled for a human. What the facet filters on. */
  reason: string;
  /** What it was for, where a row carries one. See `Expense.label`. */
  label?: string;
  amount: number;
  date: string;
  /** How the money moved, spelled for a human. */
  method: string;
  note?: string;
  channel?: string;
}

export function AdjustmentPanel({
  addOpen,
  onCloseAdd,
  showHistory = true,
}: {
  addOpen: boolean;
  onCloseAdd: () => void;
  /**
   * Whether the adjustment history Card is drawn. Off on Income & Expense
   * from 2026-09-21 evening — every row this list would carry appears in the
   * page's own unified table now, and two tables of the same rows on the same
   * page is the shape the owner asked to leave behind.
   */
  showHistory?: boolean;
}) {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm<Values>();
  /**
   * Held in state as well as in the form, because two other controls read it:
   * the reason list swaps entirely, and the marketing channel field only
   * exists on one branch of one of them.
   */
  const [direction, setDirection] = useState<Direction>("EXPENSE");
  const [reason, setReason] = useState<string>("OPERATIONAL");
  const [guideOpen, setGuideOpen] = useState(false);
  /** What has been typed into the transaction picker — a code, a serial. */
  const [orderQuery, setOrderQuery] = useState("");

  /**
   * The three ways money moves, and the labels the shop calls them by.
   *
   * The CODES come from `lib/accounts.ts`, because that module is what sorts a
   * movement into the cash or the bank balance and a fourth code appearing
   * here would be money the balance could not place. The LABELS come from
   * `db.paymentMethods`, so renaming "Bank transfer" in Settings renames it
   * here too — the same trade every other method picker in the app makes.
   */
  const methodOptions = ADJUSTMENT_METHOD_CODES.map((code) => ({
    value: code,
    label: db.paymentMethods.find((m) => m.code === code)?.label ?? code,
  }));
  const methodLabel = (code: string) =>
    db.paymentMethods.find((m) => m.code === code)?.label ?? code;

  /**
   * Switching direction resets the reason.
   *
   * It has to: the two lists share no values, so leaving "PAYROLL" selected
   * while the list shows Sales and Account transfer would submit a reason that
   * is not on offer. Defaulting to the first of the new list is the same
   * choice the form makes on open.
   */
  /** A move's name — literal `t()` calls, so `test/i18n.test.ts` sees them. */
  const moveLabel = (value: string) =>
    value === "CASH_TO_BANK"
      ? t("adjust.cashToBank", "Setor Tunai ke Bank (cash → bank)")
      : t("adjust.bankToCash", "Pencairan Dana Bank (bank → cash)");

  const pickDirection = (next: Direction) => {
    const first =
      next === "INCOME"
        ? INCOME_REASONS[0].value
        : next === "MOVE"
          ? MOVES[0].value
          : "OPERATIONAL";
    setDirection(next);
    setReason(first);
    form.setFieldsValue({ direction: next, reason: first });
  };

  const close = () => {
    onCloseAdd();
    form.resetFields();
    setDirection("EXPENSE");
    setReason("OPERATIONAL");
  };

  const save = () =>
    form.validateFields().then((v) => {
      const date = v.date.format("YYYY-MM-DD");
      mutate((d) => {
        if (v.direction === "MOVE") {
          const move = MOVES.find((m) => m.value === v.reason) ?? MOVES[0];
          const note = v.note?.trim() || moveLabel(move.value);
          d.expenses.unshift({
            id: nextId("e"),
            kind: "TRANSFER",
            label: note,
            amount: v.amount,
            date,
            method: move.from,
          });
          d.incomes.unshift({
            id: nextId("mi"),
            reason: "TRANSFER",
            amount: v.amount,
            date,
            method: move.to,
            note,
          });
          return;
        }
        if (v.direction === "INCOME") {
          d.incomes.unshift({
            id: nextId("mi"),
            reason: v.reason as IncomeReason,
            amount: v.amount,
            date,
            method: v.method,
            ...(v.note ? { note: v.note } : {}),
            ...(v.orderId ? { orderId: v.orderId } : {}),
          });
          return;
        }
        d.expenses.unshift({
          id: nextId("e"),
          kind: v.reason as ExpenseKind,
          amount: v.amount,
          date,
          method: v.method,
          ...(v.note ? { note: v.note } : {}),
          ...(v.orderId ? { orderId: v.orderId } : {}),
          // Marketing only, and only when one was named. The scorecard above
          // reads this field to attribute spend to the customers a channel
          // brought in.
          ...(v.reason === "MARKETING" && v.referralSourceId
            ? { referralSourceId: v.referralSourceId }
            : {}),
        });
      });
      message.success(
        v.direction === "MOVE"
          ? t("adjust.moveRecorded", "Money moved between cash and bank.")
          : v.direction === "INCOME"
            ? t("adjust.incomeRecorded", "Income recorded.")
            : t("adjust.expenseRecorded", "Expense recorded."),
      );
      close();
    });

  /**
   * Both halves of the ledger in one table.
   *
   * One table rather than two, because the question it answers — "what did
   * somebody type in by hand, and when" — does not split by direction. The
   * Type column carries that, and it is a facet, so the expenses-only view the
   * old table was is one click away.
   */
  const rows: Row[] = [
    ...db.incomes.map((i) => ({
      key: `i-${i.id}`,
      direction: "INCOME" as const,
      reason: labelOf(INCOME_REASON, i.reason, t),
      amount: i.amount,
      date: i.date,
      method: methodLabel(i.method),
      ...(i.note ? { note: i.note } : {}),
    })),
    ...db.expenses.map((e) => ({
      key: `e-${e.id}`,
      direction: "EXPENSE" as const,
      reason: labelOf(EXPENSE_KIND, e.kind, t),
      ...(e.label ? { label: e.label } : {}),
      amount: e.amount,
      date: e.date,
      method: methodLabel(e.method),
      ...(e.note ? { note: e.note } : {}),
      ...(e.referralSourceId
        ? {
            channel:
              db.referralSources.find((r) => r.id === e.referralSourceId)
                ?.name ?? fmtNone(),
          }
        : {}),
    })),
  ];

  /**
   * The reason list for the chosen direction.
   *
   * Widened to `string` deliberately: the two source lists are `as const`
   * tuples with disjoint literal types, and a union of two option arrays is
   * not a type antd's `options` can take. The narrowing that matters happens
   * at the write, where `save` casts to the enum the branch it is in expects —
   * and it is sound there because `pickDirection` resets the reason whenever
   * the direction changes, so the two can never disagree.
   */
  const categories: readonly {
    readonly value: string;
    readonly label: string;
    readonly guide: string;
    readonly retired?: boolean;
    readonly needsTransaction?: boolean;
  }[] =
    direction === "INCOME"
      ? INCOME_REASONS
      : direction === "MOVE"
        ? MOVES.map((m) => ({
            value: m.value,
            label: moveLabel(m.value),
            guide: "",
          }))
        : EXPENSE_CATEGORIES;
  const reasonOptions = categories
    // A retired category still reads back on rows already written; it is just
    // not something new money can be filed under (2026-09-23).
    .filter((c) => !c.retired)
    .map((c) => ({ value: c.value, label: t(c.label) }));
  /** Does the picked category mean nothing without a receipt beside it? */
  const needsTransaction =
    categories.find((c) => c.value === reason)?.needsTransaction === true;

  /**
   * The receipts the transaction picker offers.
   *
   * Searched by the shop's code, the marketplace's reference, the customer and
   * every serial on the sale — *"we can either put a serial number or a
   * transaction"* (owner, 2026-09-23). Capped, because the B2Soft history is
   * thousands of receipts and a Select holding all of them is a frozen tab.
   */
  const orderOptions = useMemo(() => {
    const needle = orderQuery.trim().toLowerCase();
    const out: { value: string; label: string }[] = [];
    for (const o of db.orders) {
      const customer =
        o.customerId === null
          ? ""
          : (db.customers.find((c) => c.id === o.customerId)?.name ?? "");
      const refs = (o.payments ?? [])
        .map((p) => p.ref ?? "")
        .filter(Boolean)
        .join(" ");
      const hay =
        `${o.code} ${refs} ${customer} ${o.serials.join(" ")}`.toLowerCase();
      if (needle !== "" && !hay.includes(needle)) continue;
      out.push({
        value: o.id,
        label: [o.code, customer, fmtDate(o.ts)].filter(Boolean).join(" · "),
      });
      if (out.length >= 50) break;
    }
    return out;
  }, [db.orders, db.customers, orderQuery]);

  return (
    <>
      {showHistory && (
        <Card title={t("adjust.history", "Adjustment history")}>
          <ProTable
            persistKey="adjustments"
            rowKey="key"
            dataSource={rows}
            searchPlaceholder={t(
              "adjust.searchReasonOrNote",
              "Search a reason or a note",
            )}
            columns={[
              {
                title: t("adjust.date", "Date"),
                dataIndex: "date",
                defaultSortOrder: "descend",
                render: fmtDate,
              },
              {
                // Narrow on purpose: antd draws a column's own filter and sort
                // controls at the right edge of its header cell, so a wide
                // column parks them a long way from the word they belong to.
                title: t("adjust.type", "Type"),
                dataIndex: "direction",
                width: 130,
                facet: true,
                facetLabel: t("adjust.type", "Type"),
                facetValue: (r: Row) =>
                  r.direction === "INCOME"
                    ? t("adjust.income", "Income")
                    : t("adjust.expense", "Expense"),
                sortValue: (r: Row) => r.direction,
                render: (v: string) =>
                  v === "INCOME" ? (
                    <Tag color="green">{t("adjust.income", "Income")}</Tag>
                  ) : (
                    <Tag color="volcano">{t("adjust.expense", "Expense")}</Tag>
                  ),
              },
              {
                title: t("adjust.reason", "Reason"),
                dataIndex: "reason",
                width: 210,
                facet: true,
                facetLabel: t("adjust.reason", "Reason"),
                searchable: true,
                sortValue: (r: Row) => r.reason,
                render: (v: string) => <Tag>{v}</Tag>,
              },
              {
                // "None" for anything typed through the adjustment dialog, which
                // asks for a reason and a note and no third name for the same
                // thing. Rows that predate it still carry one.
                title: t("adjust.what", "What"),
                dataIndex: "label",
                searchable: true,
                render: (v?: string) => v ?? fmtNone(),
              },
              {
                // Which pot it moved, as a facet: "show me everything that came
                // out of the drawer" is how a float is reconciled at closing.
                title: t("adjust.method", "How the money moved"),
                dataIndex: "method",
                width: COLUMN.status,
                facet: true,
                facetLabel: t("adjust.method", "How the money moved"),
                sortValue: (r: Row) => r.method,
                render: (v: string) => <Tag>{v}</Tag>,
              },
              {
                title: t("adjust.channel", "Channel"),
                dataIndex: "channel",
                facet: true,
                sortValue: (r: Row) => r.channel ?? fmtNone(),
                render: (v?: string) => v ?? fmtNone(),
              },
              {
                title: t("adjust.amount", "Amount"),
                key: "amount",
                align: "right",
                sortValue: (r: Row) => r.amount,
                render: (_: unknown, r: Row) => (
                  <Typography.Text
                    type={r.direction === "INCOME" ? "success" : undefined}
                  >
                    {r.direction === "INCOME" ? "+" : "−"}
                    {fmtRp(r.amount)}
                  </Typography.Text>
                ),
              },
              {
                title: t("adjust.note", "Note"),
                dataIndex: "note",
                searchable: true,
                width: 320,
                render: (v?: string) => <LongText>{v}</LongText>,
              },
            ]}
          />
        </Card>
      )}

      {/*
       * The dialog. Five questions, in the order the owner listed them —
       * direction, reason, date, amount, note — because that is also the order
       * somebody holding a receipt can answer them in.
       */}
      <Modal
        open={addOpen}
        title={t("adjust.addAdjustment", "Add adjustment")}
        okText={t("adjust.record", "Record it")}
        onCancel={close}
        onOk={save}
        // Wide enough for the two-across row the amount and date share, and no
        // wider: this is a short form and a 720px dialog around it would be
        // mostly gutter.
        width={compact ? "100%" : 520}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            direction: "EXPENSE",
            reason: "OPERATIONAL",
            date: dayjs(),
            // Cash, because the adjustments this dialog exists for are the
            // over-the-counter ones — a courier paid from the drawer, takings
            // the till missed. Anything on a bank statement is usually already
            // a sale or an invoice.
            method: "TUNAI",
          }}
        >
          {/* Segmented rather than a Select: two mutually exclusive options
              that change the form under them should show both at once, so the
              consequence of switching is visible before it is taken. */}
          <Form.Item name="direction" label={t("adjust.type", "Type")}>
            <Segmented
              block
              value={direction}
              onChange={(v) => pickDirection(v as Direction)}
              options={[
                { value: "INCOME", label: t("adjust.income", "Income") },
                { value: "EXPENSE", label: t("adjust.expense", "Expense") },
                {
                  value: "MOVE",
                  label: t("adjust.move", "Cash ↔ bank"),
                },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label={t("adjust.reason", "Reason")}
            rules={[
              {
                required: true,
                message: t("adjust.pickAReason", "Pick a reason."),
              },
            ]}
            // The "?" is on the field whose question it answers — "which of
            // these six do I pick" is asked here, not in the page header.
            extra={
              direction === "EXPENSE" ? (
                <Button
                  size="small"
                  type="link"
                  icon={<QuestionCircleOutlined />}
                  style={{ paddingInline: 0 }}
                  onClick={() => setGuideOpen(true)}
                >
                  {t("adjust.whatGoesWhere", "What goes in each category?")}
                </Button>
              ) : undefined
            }
          >
            <Select options={reasonOptions} onChange={setReason} />
          </Form.Item>

          {needsTransaction && (
            <Form.Item
              name="orderId"
              label={t("adjust.transaction", "Transaction")}
              rules={[
                {
                  required: true,
                  message: t(
                    "adjust.pickATransaction",
                    "Pick the transaction this is about.",
                  ),
                },
              ]}
            >
              <Select
                showSearch
                allowClear
                // The list is already narrowed by `orderQuery`; filtering the
                // narrowed list again would hide a match the search found.
                filterOption={false}
                onSearch={setOrderQuery}
                options={orderOptions}
                placeholder={t(
                  "adjust.searchTransaction",
                  "Search an order number, reference or serial",
                )}
              />
            </Form.Item>
          )}

          {direction === "EXPENSE" && reason === "MARKETING" && (
            <Form.Item
              name="referralSourceId"
              label={t("adjust.whichChannel", "Which channel?")}
              tooltip={t(
                "adjust.linksThisSpend",
                "Links this spend to the customers who said they came from that channel",
              )}
            >
              <Select
                allowClear
                placeholder={t("adjust.whichChannel", "Which channel?")}
                options={db.referralSources
                  .filter((r) => r.active)
                  .map((r) => ({ value: r.id, label: r.name }))}
              />
            </Form.Item>
          )}

          <Flex gap={12} wrap>
            <Form.Item
              name="date"
              label={t("adjust.date", "Date")}
              style={{ flex: "1 1 200px" }}
              rules={[
                {
                  required: true,
                  message: t("adjust.pickADate", "Pick the date."),
                },
              ]}
            >
              <DatePicker format="DD MMM YYYY" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="amount"
              label={t("adjust.amountRp", "Amount (Rp)")}
              style={{ flex: "1 1 200px" }}
              rules={[
                {
                  required: true,
                  message: t("adjust.enterTheAmount", "Enter the amount."),
                },
              ]}
            >
              <MoneyInput style={{ width: "100%" }} />
            </Form.Item>
          </Flex>

          {/*
           * Which pot the money moved through (owner ask 2026-09-09).
           *
           * Required, and it has to be: the cash balance and the bank balance
           * are exactly this answer added up, so an adjustment that will not
           * say how the money moved is one neither balance can count. There
           * are three, they are the owner's three, and a marketplace is not
           * among them — money still with Shopee is not an adjustment, it is
           * the pending table.
           */}
          {/* A move names both pots by its reason, so it asks no method. */}
          {direction !== "MOVE" && (
            <Form.Item
              name="method"
              label={t("adjust.method", "How the money moved")}
              rules={[
                {
                  required: true,
                  message: t("adjust.pickAMethod", "Pick how the money moved."),
                },
              ]}
            >
              <Select options={methodOptions} />
            </Form.Item>
          )}

          <Form.Item name="note" label={t("adjust.note", "Note")}>
            <Input.TextArea
              rows={2}
              placeholder={t(
                "adjust.notePlaceholder",
                "Optional — what this was, in your own words",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("adjust.whatGoesInEach", "What goes in each category")}
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={null}
        width={compact ? "100%" : 640}
      >
        <Table
          rowKey="value"
          size="small"
          pagination={false}
          showHeader={false}
          // Both lists, because the dialog offers both and a guide that only
          // covered the expense half would send anyone asking about "Account
          // transfer" away empty-handed.
          dataSource={[...EXPENSE_CATEGORIES, ...INCOME_REASONS].filter(
            (c) => !("retired" in c && c.retired),
          )}
          columns={[
            {
              title: t("adjust.reason", "Reason"),
              width: 200,
              render: (_, c) => (
                <Typography.Text strong>{t(c.label)}</Typography.Text>
              ),
            },
            {
              title: t("adjust.guide", "Guide"),
              render: (_, c) => t(c.guide),
            },
          ]}
        />
      </Modal>
    </>
  );
}
