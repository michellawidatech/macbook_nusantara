/**
 * Suppliers — the account, not the address book.
 *
 * > *"Their current business flow is that they can have 1 supplier in that
 * > month sending them 2-3 invoices. Then they will make a deposit to that
 * > supplier, but they have not decided where the deposit money should go …
 * > So I was thinking of making a page for supplier management instead of
 * > putting it in settings, where they can see the deposit, how many have been
 * > paid, how many have been deposited etc."*
 * > — owner, 2026-09-08
 *
 * ## Why this leaves Settings
 *
 * Settings held a supplier's name, phone and address, which was the whole of
 * what a supplier was to this app: a label on a purchase order. That is not
 * what a supplier is to the shop. The shop owes them money, has paid them
 * money in advance, and needs to know which of those covers which invoice —
 * and none of that is a setting. A page you visit to change something once a
 * year is the wrong place for a figure somebody checks before every transfer.
 *
 * Settings keeps the editing of the contact details. This owns the money.
 *
 * ## The two things the page has to make easy
 *
 * 1. **Recording a deposit that is not yet against anything.** The money moves
 *    on the 3rd and the decision comes later — see `lib/supplierLedger.ts` for
 *    why forcing it onto an invoice at that moment is worse than leaving it
 *    unallocated. It may name an invoice at the time, because sometimes the
 *    shop does know; the field is optional, which is the whole point.
 * 2. **Allocating it afterwards.** One deposit, several invoices, and the
 *    common answer is "the oldest ones until it runs out" — which should be a
 *    button rather than eleven arithmetic decisions.
 *
 * ## What 2026-09-09 added
 *
 * > *"In supplier tab, we should be able to add supplier and how much we owe
 * > them, and all the transaction history (now is deposit). So in adding
 * > deposit, we can already add which invoice we want it for, but it is an
 * > optional field. Then when adding the deposit to invoices, it should show
 * > like lists of invoice. I think for the invoice table in supplier, we
 * > should also display the INV number they input, not just the PI-XXX."*
 *
 * Four things, and each fixes a place where this page knew less than the shop.
 *
 * - **Adding a supplier here**, with what is owed from before in the same
 *   form. Settings could add one, but not the debt — so a new supplier the
 *   shop already owed money to had to be created in one screen and corrected
 *   in another. Settings keeps the address book; this owns the money, and
 *   money is what you are holding when you first write a supplier down.
 * - **A transaction history that is the whole account**, not the deposits.
 *   See `supplierHistory`.
 * - **Allocating against a LIST of invoices**, with a box per row, so one
 *   transfer covering three invoices is one dialog rather than three.
 * - **The supplier's own invoice number** beside the shop's. `PI-2026/09-…`
 *   is what this app calls the document; `INV/2026/VIII/041` is what is
 *   printed on the paper the supplier will quote at you on the telephone.
 */
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
  Select,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import { poTotals } from "../../lib/inbound.js";
import { openingPaidOf } from "../../lib/debtPayments.js";
import {
  allocationProblems,
  remainingOf,
  spreadOldestFirst,
  suggestedAllocation,
  supplierAccount,
  supplierHistory,
  type HistoryInvoice,
  type LedgerEntry,
  type LedgerInvoice,
  type SupplierAccount,
  type SupplierDeposit,
} from "../../lib/supplierLedger.js";
import { mutate, nextId, useDb, currentStaffName } from "../../mock/store.js";
import type { Po, Supplier } from "../../mock/seed.js";
import { SPACE, TYPE } from "../../theme/tokens";

interface SupplierRow {
  readonly key: string;
  readonly supplier: Supplier;
  readonly account: SupplierAccount;
}

export function SuppliersPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [depositTo, setDepositTo] = useState<Supplier | null>(null);
  const [allocating, setAllocating] = useState<{
    deposit: SupplierDeposit;
    supplier: Supplier;
  } | null>(null);
  const [openingFor, setOpeningFor] = useState<Supplier | null>(null);
  /** The add-a-supplier dialog. See `saveSupplier`. */
  const [adding, setAdding] = useState(false);
  const [addForm] = Form.useForm<{
    name: string;
    code?: string;
    phone?: string;
    address?: string;
    openingBalance?: number;
  }>();
  const [depForm] = Form.useForm<{
    amount: number;
    method: string;
    at: dayjs.Dayjs;
    /** Optional — an invoice the shop already knows this deposit is for. */
    poId?: string;
    note?: string;
    /** `SupplierDeposit.inBalance` — the payment switch (2026-09-22). */
    inBalance?: boolean;
  }>();
  /**
   * How much of the open deposit goes against each invoice, keyed by invoice.
   *
   * A map rather than a single amount, because the dialog is now a LIST (owner
   * ask 2026-09-09): one transfer covering three invoices was three trips
   * through a dialog that could only ever name one.
   */
  const [allocDraft, setAllocDraft] = useState<Record<string, number>>({});
  const [openForm] = Form.useForm<{ amount: number }>();

  /**
   * Every invoice as the ledger sees it.
   *
   * A CLOSED invoice is excluded from what is owed, because closing is exactly
   * the judgement that nothing more will be recorded on it (see `Po.closedAt`).
   * A draft is excluded too: it is a document nobody has sent.
   */
  const invoices = useMemo<LedgerInvoice[]>(
    () =>
      db.pos.map((po) => {
        const totals = poTotals(po);
        return {
          id: po.id,
          supplierId: po.supplierId,
          date: po.date,
          total: totals.total,
          paid: totals.paid,
          ignore: po.status === "DRAFT" || po.closedAt !== undefined,
        };
      }),
    [db.pos],
  );

  const rows = useMemo<SupplierRow[]>(
    () =>
      db.suppliers
        .map((s) => ({
          key: s.id,
          supplier: s,
          account: supplierAccount(
            s.id,
            invoices,
            db.deposits,
            s.openingBalance ?? 0,
            openingPaidOf(s),
          ),
        }))
        // The ones the shop owes most, first. This is a page somebody opens
        // before making a transfer.
        .sort((a, b) => b.account.netOwed - a.account.netOwed),
    [db.suppliers, invoices, db.deposits],
  );

  const owedTotal = rows.reduce((n, r) => n + r.account.netOwed, 0);
  const onDeposit = rows.reduce((n, r) => n + r.account.unallocated, 0);

  const posOf = (id: string) =>
    db.pos.filter(
      (p) =>
        p.supplierId === id && p.status !== "DRAFT" && p.closedAt === undefined,
    );
  const outstandingOf = (po: Po) => poTotals(po).outstanding;

  /**
   * Open the deposit dialog on a clean form.
   *
   * `resetFields` FIRST, and that is the whole reason this is a function
   * rather than two `setFieldsValue` calls: the invoice field is scoped to one
   * supplier, so a `poId` left over from the last time the dialog was open
   * would put money against a different supplier's invoice.
   */
  const openDeposit = () => {
    depForm.resetFields();
    depForm.setFieldsValue({
      method: "TRANSFER",
      at: dayjs(),
      inBalance: true,
    });
  };

  /**
   * Record money paid in advance — optionally already spoken for.
   *
   * The invoice field is OPTIONAL and that is the whole design (owner ask
   * 2026-09-09: *"we can already add which invoice we want it for, but it is
   * an optional field"*). Most transfers are made before anybody has decided;
   * some are made because an invoice landed this morning. Forcing the second
   * case through "record a deposit, then allocate it" is two dialogs for one
   * fact, and forcing the first to name an invoice is a guess in a ledger.
   *
   * When one IS named, the allocation is written in the same `mutate` — so the
   * deposit and the `PoPayment` it funds can never exist without each other.
   * Capped at what the invoice still owes, because a deposit bigger than the
   * bill is exactly the case where the rest genuinely is unallocated.
   */
  const saveDeposit = () =>
    depForm.validateFields().then((v) => {
      const supplier = depositTo!;
      const at = (v.at ?? dayjs()).toISOString();
      const po = v.poId ? db.pos.find((p) => p.id === v.poId) : undefined;
      const put = po ? suggestedAllocation(v.amount, outstandingOf(po)) : 0;
      const depositId = nextId("dep");
      mutate((d) => {
        d.deposits.unshift({
          id: depositId,
          supplierId: supplier.id,
          amount: v.amount,
          method: v.method,
          at,
          ...(v.note ? { note: v.note } : {}),
          // The payment switch (owner answer 2026-09-22): off for money the
          // owner sent from their own account, so the balance is untouched.
          ...(v.inBalance === false ? { inBalance: false } : {}),
          staff: currentStaffName(),
          allocations:
            po && put > 0
              ? [
                  {
                    id: nextId("alloc"),
                    poId: po.id,
                    amount: put,
                    at,
                    staff: currentStaffName(),
                  },
                ]
              : [],
        });
        if (po && put > 0) {
          d.pos
            .find((p) => p.id === po.id)
            ?.payments.push({
              id: nextId("pp"),
              method: v.method,
              amount: put,
              at,
              appliedTo: "ORDER",
              fromDepositId: depositId,
            });
        }
      });
      setDepositTo(null);
      depForm.resetFields();
      message.success(
        po && put > 0
          ? t(
              "supplier.depositSavedFor",
              "{{amount}} recorded for {{name}}, {{put}} of it against {{code}}.",
              {
                amount: fmtRp(v.amount),
                name: supplier.name,
                put: fmtRp(put),
                code: po.code,
              },
            )
          : t("supplier.depositSaved", "{{amount}} recorded for {{name}}.", {
              amount: fmtRp(v.amount),
              name: supplier.name,
            }),
      );
    });

  /**
   * Write a supplier down, with what is already owed to them.
   *
   * The three checks are Settings' own, restated rather than shared because
   * they read the store and Settings' copy is inside its own form's validator.
   * A name collision is a warning about a duplicate account; a code collision
   * is worse than that — two suppliers sharing an origin code would file two
   * pallets of machines under serials nobody could tell apart.
   */
  const saveSupplier = () =>
    addForm.validateFields().then((v) => {
      const name = v.name.trim();
      const code = (v.code ?? "").trim().toUpperCase();
      if (
        db.suppliers.some((x) => x.name.toLowerCase() === name.toLowerCase())
      ) {
        message.error(
          t("supplier.nameTaken", "A supplier with that name already exists."),
        );
        return;
      }
      if (code !== "" && !/^[A-Z]{2}$/.test(code)) {
        message.error(
          t(
            "supplier.codeShape",
            "A supplier code is exactly two capital letters.",
          ),
        );
        return;
      }
      if (code !== "" && db.suppliers.some((x) => x.code === code)) {
        message.error(
          t(
            "supplier.codeTaken",
            "{{code}} already belongs to another supplier.",
            {
              code,
            },
          ),
        );
        return;
      }
      mutate((d) => {
        d.suppliers.push({
          id: nextId("sup"),
          name,
          ...(code ? { code } : {}),
          ...(v.phone ? { phone: v.phone } : {}),
          ...(v.address ? { address: v.address } : {}),
          // Stated once, here, rather than as an invented purchase order —
          // see `Supplier.openingBalance`.
          ...(v.openingBalance
            ? {
                openingBalance: v.openingBalance,
                openingBalanceAt: new Date().toISOString(),
              }
            : {}),
        });
      });
      setAdding(false);
      addForm.resetFields();
      message.success(t("supplier.added", "{{name}} added.", { name }));
    });

  /**
   * Put a deposit against invoices — plural (owner ask 2026-09-09).
   *
   * > *"Then when adding the deposit to invoices, it should show like lists of
   * > invoice."*
   *
   * It used to name ONE invoice in a `Select`, which is a dialog that has to
   * be opened three times for a transfer covering three bills, and which
   * showed nothing about the invoices it was choosing between except a line of
   * text in a dropdown. The dialog is now the list itself, with a box per row
   * and the running total under it, so the decision is taken by looking rather
   * than by remembering.
   *
   * Every row is checked before anything is written: a dialog that writes four
   * allocations and then refuses the fifth has left the ledger in a state
   * nobody asked for.
   */
  const saveAllocation = () => {
    const { deposit, supplier } = allocating!;
    const plan = Object.entries(allocDraft)
      .map(([poId, amount]) => ({ poId, amount: amount ?? 0 }))
      .filter((a) => a.amount > 0);
    if (plan.length === 0) {
      message.error(
        t(
          "supplier.allocateNothing",
          "Put an amount against at least one invoice.",
        ),
      );
      return;
    }
    const asked = plan.reduce((n, a) => n + a.amount, 0);
    if (asked > remainingOf(deposit)) {
      message.error(
        t(
          "supplier.allocateTooMuch",
          "That is more than this deposit has left.",
        ),
      );
      return;
    }
    for (const a of plan) {
      const po = db.pos.find((p) => p.id === a.poId);
      if (!po) continue;
      const problems = allocationProblems({
        amount: a.amount,
        // Checked against the whole deposit rather than a running remainder:
        // the sum is checked once above, and reporting "more than the deposit
        // has left" per row would blame whichever invoice happened to be last.
        depositRemaining: remainingOf(deposit),
        invoiceOutstanding: outstandingOf(po),
      });
      if (problems.length > 0) {
        message.error(`${po.code}: ${problems[0]!}`);
        return;
      }
    }
    const at = new Date().toISOString();
    mutate((d) => {
      const i = d.deposits.findIndex((x) => x.id === deposit.id);
      if (i >= 0) {
        const dep = d.deposits[i]!;
        d.deposits[i] = {
          ...dep,
          allocations: [
            ...dep.allocations,
            ...plan.map((a, n) => ({
              id: nextId(`alloc${n}`),
              poId: a.poId,
              amount: a.amount,
              at,
              staff: currentStaffName(),
            })),
          ],
        };
      }
      for (const a of plan) {
        d.pos
          .find((p) => p.id === a.poId)
          ?.payments.push({
            id: nextId("pp"),
            method: deposit.method,
            amount: a.amount,
            at,
            appliedTo: "ORDER",
            fromDepositId: deposit.id,
          });
      }
    });
    setAllocating(null);
    setAllocDraft({});
    message.success(
      t(
        "supplier.allocatedAcross",
        "{{amount}} put against {{n}} invoice(s) for {{name}}.",
        {
          amount: fmtRp(asked),
          n: plan.length,
          name: supplier.name,
        },
      ),
    );
  };

  /**
   * Spread what is left of a deposit over the oldest invoices.
   *
   * One press for the answer the shop gives nine times out of ten. Oldest
   * first is the shop's rule and not the arithmetic's — an invoice six weeks
   * outstanding is the one the supplier telephones about.
   */
  const autoAllocate = (deposit: SupplierDeposit, supplier: Supplier) => {
    const plan = spreadOldestFirst(
      remainingOf(deposit),
      posOf(supplier.id).map((p) => ({
        id: p.id,
        date: p.date,
        outstanding: outstandingOf(p),
      })),
    );
    if (plan.length === 0) {
      message.info(
        t(
          "supplier.nothingToAllocate",
          "Nothing is outstanding to put it against.",
        ),
      );
      return;
    }
    const at = new Date().toISOString();
    mutate((d) => {
      const i = d.deposits.findIndex((x) => x.id === deposit.id);
      if (i >= 0) {
        const dep = d.deposits[i]!;
        d.deposits[i] = {
          ...dep,
          allocations: [
            ...dep.allocations,
            ...plan.map((a, n) => ({
              id: nextId(`alloc${n}`),
              poId: a.poId,
              amount: a.amount,
              at,
              staff: currentStaffName(),
            })),
          ],
        };
      }
      for (const a of plan) {
        d.pos
          .find((p) => p.id === a.poId)
          ?.payments.push({
            id: nextId("pp"),
            method: deposit.method,
            amount: a.amount,
            at,
            appliedTo: "ORDER",
            fromDepositId: deposit.id,
          });
      }
    });
    message.success(
      t("supplier.spread", "Spread across {{n}} invoice(s).", {
        n: plan.length,
      }),
    );
  };

  const saveOpening = () =>
    openForm.validateFields().then((v) => {
      const supplier = openingFor!;
      mutate((d) => {
        const s = d.suppliers.find((x) => x.id === supplier.id);
        if (!s) return;
        s.openingBalance = v.amount;
        s.openingBalanceAt = new Date().toISOString();
      });
      setOpeningFor(null);
      openForm.resetFields();
      message.success(t("supplier.openingSaved", "Opening balance saved."));
    });

  /** The history rows for one supplier, built where the store is in scope. */
  const historyOf = (supplier: Supplier): LedgerEntry[] =>
    supplierHistory(
      supplier.id,
      db.pos
        .filter((p) => p.status !== "DRAFT")
        .map<HistoryInvoice>((po) => {
          const totals = poTotals(po);
          return {
            id: po.id,
            code: po.code,
            supplierId: po.supplierId,
            date: po.date,
            total: totals.total,
            paid: totals.paid,
            ...(po.invoice && !po.noInvoice ? { invoiceNo: po.invoice } : {}),
            payments: po.payments.map((pp) => ({
              id: pp.id,
              at: pp.at,
              amount: pp.amount,
              method: pp.method,
              ...(pp.fromDepositId ? { fromDepositId: pp.fromDepositId } : {}),
            })),
          };
        }),
      db.deposits,
      {
        amount: supplier.openingBalance ?? 0,
        ...(supplier.openingBalanceAt ? { at: supplier.openingBalanceAt } : {}),
        payments: supplier.openingPayments ?? [],
      },
    );

  const methodLabel = (code: string) =>
    db.paymentMethods.find((m) => m.code === code)?.label ?? code;

  /** What one history row is called, and the colour it carries. */
  const ENTRY: Record<LedgerEntry["kind"], { label: string; color?: string }> =
    {
      INVOICE: { label: t("supplier.entryInvoice", "Invoice"), color: "blue" },
      PAYMENT: { label: t("supplier.entryPayment", "Payment"), color: "green" },
      DEPOSIT: { label: t("supplier.entryDeposit", "Deposit"), color: "gold" },
      ALLOCATION: {
        label: t("supplier.entryAllocation", "Deposit used"),
        color: "default",
      },
      OPENING: { label: t("supplier.entryOpening", "From before") },
    };

  return (
    <PageContainer
      title={t("supplier.title", "Suppliers")}
      actions={[
        {
          key: "add",
          label: t("supplier.addSupplier", "Add supplier"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => {
            setAdding(true);
            addForm.resetFields();
          },
        },
      ]}
    >
      <Flex vertical gap={SPACE.md}>
        <Flex gap={SPACE.md} wrap>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title={t("supplier.owedTotal", "Owed to suppliers")}
              value={fmtRp(owedTotal)}
              styles={{ content: { color: "#cf1322" } }}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "supplier.owedHint",
                "Open invoices and old debts, less what is already on deposit.",
              )}
            </Typography.Text>
          </Card>
          <Card style={{ flex: 1, minWidth: 220 }}>
            <Statistic
              title={t("supplier.onDeposit", "On deposit, unallocated")}
              value={fmtRp(onDeposit)}
              styles={{ content: { color: "#d48806" } }}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "supplier.onDepositHint",
                "Paid in advance and not yet put against an invoice.",
              )}
            </Typography.Text>
          </Card>
        </Flex>

        <Card title={t("supplier.accounts", "Accounts")}>
          <Table<SupplierRow>
            size="small"
            rowKey="key"
            dataSource={rows}
            pagination={false}
            expandable={{
              expandedRowRender: (r) => (
                <Flex vertical gap={SPACE.md}>
                  <Card size="small" title={t("supplier.invoices", "Invoices")}>
                    <Table<Po>
                      size="small"
                      rowKey="id"
                      dataSource={posOf(r.supplier.id)}
                      pagination={false}
                      locale={{
                        emptyText: t(
                          "supplier.noInvoices",
                          "No open invoices.",
                        ),
                      }}
                      columns={[
                        {
                          title: t("supplier.invoice", "Invoice"),
                          key: "code",
                          render: (_, po) => (
                            <Flex vertical gap={0}>
                              <Link to={`/inbound/${po.id}`}>{po.code}</Link>
                              {/*
                               * The SUPPLIER's number, under the shop's (owner
                               * ask 2026-09-09). `PI-2026/09-000003` is what
                               * this app calls the document and is useless on
                               * the telephone; the number the supplier printed
                               * is the one they will quote. Both, because a
                               * link has to say where it goes.
                               */}
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: TYPE.sm }}
                              >
                                {po.noInvoice
                                  ? t(
                                      "supplier.noInvoiceNo",
                                      "No invoice issued",
                                    )
                                  : po.invoice ||
                                    t(
                                      "supplier.noInvoiceNoYet",
                                      "No number yet",
                                    )}
                              </Typography.Text>
                            </Flex>
                          ),
                        },
                        {
                          title: t("supplier.date", "Date"),
                          key: "date",
                          width: 130,
                          render: (_, po) => fmtDate(po.date),
                        },
                        {
                          title: t("supplier.total", "Total"),
                          key: "total",
                          width: 160,
                          align: "right",
                          render: (_, po) => fmtRp(poTotals(po).total),
                        },
                        {
                          title: t("supplier.paid", "Paid"),
                          key: "paid",
                          width: 160,
                          align: "right",
                          render: (_, po) => fmtRp(poTotals(po).paid),
                        },
                        {
                          title: t("supplier.outstanding", "Outstanding"),
                          key: "outstanding",
                          width: 170,
                          align: "right",
                          render: (_, po) => {
                            const out = outstandingOf(po);
                            return out === 0 ? (
                              <Tag color="green">
                                {t("supplier.settledTag", "Settled")}
                              </Tag>
                            ) : (
                              <Typography.Text type="danger">
                                {fmtRp(out)}
                              </Typography.Text>
                            );
                          },
                        },
                      ]}
                    />
                  </Card>

                  <Card
                    size="small"
                    title={t("supplier.deposits", "Deposits")}
                    extra={
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          setDepositTo(r.supplier);
                          openDeposit();
                        }}
                      >
                        {t("supplier.addDeposit", "Record a deposit")}
                      </Button>
                    }
                  >
                    <Table<SupplierDeposit>
                      size="small"
                      rowKey="id"
                      dataSource={db.deposits.filter(
                        (d) => d.supplierId === r.supplier.id,
                      )}
                      pagination={false}
                      locale={{
                        emptyText: t(
                          "supplier.noDeposits",
                          "Nothing paid in advance.",
                        ),
                      }}
                      expandable={{
                        rowExpandable: (d) => d.allocations.length > 0,
                        expandedRowRender: (d) => (
                          <Table
                            size="small"
                            rowKey="id"
                            dataSource={[...d.allocations]}
                            pagination={false}
                            columns={[
                              {
                                title: t("supplier.invoice", "Invoice"),
                                key: "po",
                                render: (
                                  _: unknown,
                                  a: (typeof d.allocations)[number],
                                ) =>
                                  db.pos.find((p) => p.id === a.poId)?.code ??
                                  a.poId,
                              },
                              {
                                title: t("supplier.when", "When"),
                                key: "at",
                                width: 140,
                                render: (
                                  _: unknown,
                                  a: (typeof d.allocations)[number],
                                ) => fmtDate(a.at),
                              },
                              {
                                title: t("supplier.amount", "Amount"),
                                key: "amount",
                                width: 160,
                                align: "right",
                                render: (
                                  _: unknown,
                                  a: (typeof d.allocations)[number],
                                ) => fmtRp(a.amount),
                              },
                            ]}
                          />
                        ),
                      }}
                      columns={[
                        {
                          title: t("supplier.when", "When"),
                          key: "at",
                          width: 140,
                          render: (_, d) => fmtDate(d.at),
                        },
                        {
                          title: t("supplier.note", "Note"),
                          key: "note",
                          render: (_, d) => d.note ?? fmtNone(),
                        },
                        {
                          title: t("supplier.amount", "Amount"),
                          key: "amount",
                          width: 160,
                          align: "right",
                          render: (_, d) => fmtRp(d.amount),
                        },
                        {
                          title: t("supplier.left", "Unallocated"),
                          key: "left",
                          width: 170,
                          align: "right",
                          render: (_, d) => {
                            const left = remainingOf(d);
                            return left === 0 ? (
                              <Tag>{t("supplier.allSpent", "All used")}</Tag>
                            ) : (
                              <Typography.Text type="warning" strong>
                                {fmtRp(left)}
                              </Typography.Text>
                            );
                          },
                        },
                        {
                          title: "",
                          key: "actions",
                          width: 96,
                          render: (_, d) =>
                            remainingOf(d) === 0 ? null : (
                              <Flex gap={4} justify="end">
                                <Tooltip
                                  title={t(
                                    "supplier.allocateHint",
                                    "Put it against invoices",
                                  )}
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<PlusOutlined />}
                                    aria-label={t(
                                      "supplier.allocateAria",
                                      "Allocate this deposit",
                                    )}
                                    onClick={() => {
                                      setAllocating({
                                        deposit: d,
                                        supplier: r.supplier,
                                      });
                                      // Opens empty. A prefilled first row was
                                      // fine when the dialog could only name
                                      // one invoice; on a list it would be the
                                      // dialog making a decision on the
                                      // reader's behalf before they have
                                      // looked at the other rows.
                                      setAllocDraft({});
                                    }}
                                  />
                                </Tooltip>
                                <Tooltip
                                  title={t(
                                    "supplier.spreadHint",
                                    "Spread it over the oldest invoices",
                                  )}
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<ThunderboltOutlined />}
                                    aria-label={t(
                                      "supplier.spreadAria",
                                      "Spread this deposit over the oldest invoices",
                                    )}
                                    onClick={() => autoAllocate(d, r.supplier)}
                                  />
                                </Tooltip>
                              </Flex>
                            ),
                        },
                      ]}
                    />
                  </Card>

                  {/*
                   * Everything that has moved on this account (owner ask
                   * 2026-09-09). The two cards above answer "what is still
                   * open?"; this one answers "what has happened?", which is
                   * the question asked when a supplier telephones about a
                   * figure. See `supplierHistory` for why an allocation is a
                   * row of its own that moves nothing.
                   */}
                  <Card
                    size="small"
                    title={t("supplier.history", "Transaction history")}
                  >
                    <Table<LedgerEntry>
                      size="small"
                      rowKey="id"
                      dataSource={historyOf(r.supplier)}
                      pagination={{ pageSize: 10, hideOnSinglePage: true }}
                      locale={{
                        emptyText: t(
                          "supplier.noHistory",
                          "Nothing has moved on this account yet.",
                        ),
                      }}
                      columns={[
                        {
                          title: t("supplier.when", "When"),
                          key: "at",
                          width: 130,
                          render: (_, e) =>
                            e.at
                              ? fmtDate(e.at)
                              : t("supplier.undated", "Undated"),
                        },
                        {
                          title: t("supplier.what", "What"),
                          key: "kind",
                          width: 140,
                          render: (_, e) => (
                            <Tag color={ENTRY[e.kind].color}>
                              {ENTRY[e.kind].label}
                            </Tag>
                          ),
                        },
                        {
                          title: t("supplier.reference", "Reference"),
                          key: "ref",
                          render: (_, e) => {
                            const po = e.poId
                              ? db.pos.find((p) => p.id === e.poId)
                              : undefined;
                            return (
                              <Flex vertical gap={0}>
                                {po ? (
                                  <Link to={`/inbound/${po.id}`}>
                                    {po.code}
                                  </Link>
                                ) : (
                                  <Typography.Text>
                                    {e.method
                                      ? methodLabel(e.method)
                                      : fmtNone()}
                                  </Typography.Text>
                                )}
                                {(e.note || (po && e.method)) && (
                                  <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: TYPE.sm }}
                                  >
                                    {[
                                      e.note,
                                      po && e.method
                                        ? methodLabel(e.method)
                                        : undefined,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </Typography.Text>
                                )}
                              </Flex>
                            );
                          },
                        },
                        {
                          /*
                           * Signed from the SHOP's point of view: a charge is
                           * money it now owes, a payment is money gone. An
                           * allocation gets neither sign, because it is the
                           * same rupiah being labelled — see the header of
                           * `supplierHistory`.
                           */
                          title: t("supplier.amount", "Amount"),
                          key: "amount",
                          width: 170,
                          align: "right",
                          render: (_, e) =>
                            e.direction === "CHARGE" ? (
                              <Typography.Text type="danger">
                                +{fmtRp(e.amount)}
                              </Typography.Text>
                            ) : e.direction === "PAYMENT" ? (
                              <Typography.Text type="success">
                                −{fmtRp(e.amount)}
                              </Typography.Text>
                            ) : (
                              <Typography.Text type="secondary">
                                {fmtRp(e.amount)}
                              </Typography.Text>
                            ),
                        },
                      ]}
                    />
                  </Card>
                </Flex>
              ),
            }}
            columns={[
              {
                title: t("supplier.name", "Supplier"),
                key: "name",
                render: (_, r) => (
                  <Flex vertical gap={0}>
                    <Typography.Text strong>{r.supplier.name}</Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {[r.supplier.code, r.supplier.phone]
                        .filter(Boolean)
                        .join(" · ") || fmtNone()}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("supplier.openInvoices", "Open invoices"),
                key: "open",
                width: 140,
                align: "right",
                render: (_, r) => r.account.openInvoices,
              },
              {
                title: t("supplier.invoiced", "Invoiced"),
                key: "invoiced",
                width: 170,
                align: "right",
                render: (_, r) => fmtRp(r.account.invoiced),
              },
              {
                title: t("supplier.paid", "Paid"),
                key: "paid",
                width: 170,
                align: "right",
                render: (_, r) => fmtRp(r.account.paid),
              },
              {
                /*
                 * Debt from before this system, stated once. Editable here
                 * because there is nowhere else it could be: no invoice in
                 * this database is about it, and inventing one would put
                 * phantom stock in the ledger.
                 */
                title: t("supplier.oldDebt", "From before"),
                key: "opening",
                width: 170,
                align: "right",
                render: (_, r) => (
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingInline: 0 }}
                    onClick={() => {
                      setOpeningFor(r.supplier);
                      openForm.setFieldsValue({
                        amount: r.supplier.openingBalance ?? 0,
                      });
                    }}
                  >
                    {r.account.openingBalance > 0
                      ? fmtRp(r.account.openingBalance)
                      : t("supplier.addOldDebt", "Add")}
                  </Button>
                ),
              },
              {
                title: t("supplier.onDepositCol", "On deposit"),
                key: "deposit",
                width: 170,
                align: "right",
                render: (_, r) =>
                  r.account.unallocated === 0 ? (
                    fmtRp(0)
                  ) : (
                    <Typography.Text type="warning">
                      {fmtRp(r.account.unallocated)}
                    </Typography.Text>
                  ),
              },
              {
                /*
                 * What a transfer today would have to be. The deposit comes
                 * off, because it is money the supplier already has — and a
                 * supplier holding more than they are owed shows as a credit
                 * rather than as a negative debt.
                 */
                title: t("supplier.netOwed", "Owed now"),
                key: "net",
                width: 190,
                align: "right",
                render: (_, r) => (
                  <Flex vertical align="flex-end" gap={0}>
                    {r.account.credit > 0 ? (
                      <Typography.Text type="success" strong>
                        {t("supplier.inCredit", "{{amount}} in credit", {
                          amount: fmtRp(r.account.credit),
                        })}
                      </Typography.Text>
                    ) : (
                      <Typography.Text
                        type={r.account.netOwed > 0 ? "danger" : undefined}
                        strong
                      >
                        {fmtRp(r.account.netOwed)}
                      </Typography.Text>
                    )}
                    {r.account.oldestUnpaidAt && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("supplier.oldestSince", "oldest since {{date}}", {
                          date: fmtDate(r.account.oldestUnpaidAt),
                        })}
                      </Typography.Text>
                    )}
                  </Flex>
                ),
              },
              {
                title: "",
                key: "actions",
                width: 56,
                render: (_, r) => (
                  <Tooltip title={t("supplier.addDeposit", "Record a deposit")}>
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      aria-label={t(
                        "supplier.addDepositAria",
                        "Record a deposit for {{name}}",
                        { name: r.supplier.name },
                      )}
                      onClick={() => {
                        setDepositTo(r.supplier);
                        openDeposit();
                      }}
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      <Modal
        open={depositTo !== null}
        title={t("supplier.depositTitle", "Deposit to {{name}}", {
          name: depositTo?.name ?? "",
        })}
        okText={t("supplier.depositOk", "Record it")}
        onCancel={() => setDepositTo(null)}
        onOk={saveDeposit}
      >
        <Form form={depForm} layout="vertical">
          <Form.Item
            name="amount"
            label={t("supplier.amount", "Amount")}
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
          <Form.Item name="method" label={t("supplier.method", "How")}>
            <Select
              options={db.paymentMethods
                .filter((m) => m.forPo && m.active)
                .map((m) => ({ value: m.code, label: m.label }))}
            />
          </Form.Item>
          <Form.Item name="at" label={t("supplier.when", "When")}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          {/*
           * Optional, and that is the design (owner ask 2026-09-09). Most
           * transfers are made before anybody has decided which invoice they
           * settle — which is the whole reason a deposit exists rather than a
           * payment. Some are not, and making those go through a second dialog
           * was two steps for one fact.
           */}
          <Form.Item
            name="poId"
            label={t("supplier.forInvoice", "For an invoice?")}
            tooltip={t(
              "supplier.forInvoiceHint",
              "Leave this empty if nobody has decided yet — the money sits against the supplier until somebody does.",
            )}
          >
            <Select
              allowClear
              placeholder={t("supplier.notDecidedYet", "Not decided yet")}
              options={
                depositTo
                  ? posOf(depositTo.id)
                      .filter((p) => outstandingOf(p) > 0)
                      .map((p) => ({
                        value: p.id,
                        label: `${p.code}${
                          p.invoice && !p.noInvoice ? ` · ${p.invoice}` : ""
                        } · ${fmtRp(outstandingOf(p))} ${t(
                          "supplier.stillOwed",
                          "still owed",
                        )}`,
                      }))
                  : []
              }
            />
          </Form.Item>
          <Form.Item name="note" label={t("supplier.note", "Note")}>
            <Input placeholder={t("supplier.notePlaceholder", "Optional")} />
          </Form.Item>
          <Form.Item
            name="inBalance"
            valuePropName="checked"
            label={t("debtPay.inBalance", "Counts in the shop's balance")}
            extra={t(
              "supplier.inBalanceHint",
              "Turn off when the money did not come out of the shop's cash or bank.",
            )}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/*
       * Writing a supplier down, with what is already owed to them (owner ask
       * 2026-09-09). Settings can add one too and keeps the address book; what
       * it cannot do is state the debt, so a supplier the shop already owed
       * money to had to be created in one screen and corrected in another.
       */}
      <Modal
        open={adding}
        title={t("supplier.addTitle", "Add a supplier")}
        okText={t("supplier.addOk", "Add supplier")}
        onCancel={() => {
          setAdding(false);
          addForm.resetFields();
        }}
        onOk={saveSupplier}
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("supplier.nameLabel", "Name")}
            rules={[{ required: true }]}
          >
            <Input
              placeholder={t("supplier.namePlaceholder", "CV Apel Segar")}
            />
          </Form.Item>
          <Form.Item
            name="code"
            label={t("supplier.codeLabel", "Origin code")}
            tooltip={t(
              "supplier.codeHint",
              "Two capitals. It goes on the front of every store barcode printed for a unit bought from them, so a serial says which pallet it came off.",
            )}
          >
            <Input maxLength={2} placeholder="AS" />
          </Form.Item>
          <Form.Item name="phone" label={t("supplier.phone", "Phone")}>
            <Input placeholder="+62…" />
          </Form.Item>
          <Form.Item name="address" label={t("supplier.address", "Address")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="openingBalance"
            label={t("supplier.oldDebtLabel", "What we already owe them")}
            tooltip={t(
              "supplier.oldDebtHint",
              "An unpaid bill from before this app. There is no invoice here for it and there never will be, so it is stated once and added to what the invoices say.",
            )}
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
        </Form>
      </Modal>

      <Modal
        open={allocating !== null}
        title={t("supplier.allocateTitle", "Put this deposit against invoices")}
        okText={t("supplier.allocateOk", "Allocate")}
        onCancel={() => {
          setAllocating(null);
          setAllocDraft({});
        }}
        onOk={saveAllocation}
        // Wide enough for a table: the whole point of the 2026-09-09 revision
        // is that the invoices are looked at rather than picked from a
        // dropdown, and five columns in 520px is five slivers.
        width={720}
      >
        {allocating &&
          (() => {
            const open = posOf(allocating.supplier.id).filter(
              (p) => outstandingOf(p) > 0,
            );
            const left = remainingOf(allocating.deposit);
            const put = Object.values(allocDraft).reduce(
              (n, v) => n + (v ?? 0),
              0,
            );
            return (
              <Flex vertical gap={SPACE.sm}>
                <Typography.Text type="secondary">
                  {t(
                    "supplier.allocateHave",
                    "{{amount}} unallocated, paid {{when}} by {{method}}.",
                    {
                      amount: fmtRp(left),
                      when: fmtDate(allocating.deposit.at),
                      method: methodLabel(allocating.deposit.method),
                    },
                  )}
                </Typography.Text>
                <Table<Po>
                  size="small"
                  rowKey="id"
                  dataSource={open}
                  pagination={false}
                  locale={{
                    emptyText: t(
                      "supplier.nothingOutstanding",
                      "Nothing is outstanding to put it against.",
                    ),
                  }}
                  columns={[
                    {
                      title: t("supplier.invoice", "Invoice"),
                      key: "code",
                      render: (_, po) => (
                        <Flex vertical gap={0}>
                          <Typography.Text strong>{po.code}</Typography.Text>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: TYPE.sm }}
                          >
                            {po.noInvoice
                              ? t("supplier.noInvoiceNo", "No invoice issued")
                              : po.invoice ||
                                t("supplier.noInvoiceNoYet", "No number yet")}
                          </Typography.Text>
                        </Flex>
                      ),
                    },
                    {
                      title: t("supplier.date", "Date"),
                      key: "date",
                      width: 120,
                      render: (_, po) => fmtDate(po.date),
                    },
                    {
                      title: t("supplier.outstanding", "Outstanding"),
                      key: "out",
                      width: 150,
                      align: "right",
                      render: (_, po) => fmtRp(outstandingOf(po)),
                    },
                    {
                      title: t("supplier.putAgainst", "Put against it"),
                      key: "amount",
                      width: 190,
                      render: (_, po) => (
                        <Flex gap={4} align="center">
                          <InputNumber
                            size="small"
                            min={0}
                            precision={0}
                            prefix={RP_SYMBOL}
                            formatter={moneyFormatter}
                            parser={moneyParser}
                            style={{ width: "100%" }}
                            aria-label={t(
                              "supplier.putAgainstAria",
                              "Amount to put against {{code}}",
                              { code: po.code },
                            )}
                            value={allocDraft[po.id] ?? null}
                            onChange={(v) =>
                              setAllocDraft((d) => ({
                                ...d,
                                [po.id]: v ?? 0,
                              }))
                            }
                          />
                          {/*
                           * Fill this row with whatever is sensible — the
                           * smaller of what the invoice owes and what is left
                           * AFTER the other rows. It is the number somebody
                           * would type, and typing it is where the arithmetic
                           * mistakes come from.
                           */}
                          <Tooltip
                            title={t("supplier.fillRow", "Fill what it owes")}
                          >
                            <Button
                              size="small"
                              type="text"
                              icon={<ThunderboltOutlined />}
                              aria-label={t(
                                "supplier.fillRowAria",
                                "Fill what {{code}} owes",
                                { code: po.code },
                              )}
                              onClick={() =>
                                setAllocDraft((d) => {
                                  const others = Object.entries(d)
                                    .filter(([k]) => k !== po.id)
                                    .reduce((n, [, v]) => n + (v ?? 0), 0);
                                  return {
                                    ...d,
                                    [po.id]: suggestedAllocation(
                                      Math.max(0, left - others),
                                      outstandingOf(po),
                                    ),
                                  };
                                })
                              }
                            />
                          </Tooltip>
                        </Flex>
                      ),
                    },
                  ]}
                />
                {/*
                 * The running total, said out loud. The refusal in
                 * `saveAllocation` is the gate; this is what stops somebody
                 * reaching it — an over-allocation is arithmetic, and
                 * arithmetic should be shown rather than checked.
                 */}
                <Flex justify="space-between">
                  <Typography.Text type="secondary">
                    {t("supplier.allocating", "Allocating")}
                  </Typography.Text>
                  <Typography.Text
                    strong
                    type={put > left ? "danger" : undefined}
                  >
                    {t("supplier.ofRemaining", "{{put}} of {{left}}", {
                      put: fmtRp(put),
                      left: fmtRp(left),
                    })}
                  </Typography.Text>
                </Flex>
              </Flex>
            );
          })()}
      </Modal>

      <Modal
        open={openingFor !== null}
        title={t("supplier.openingTitle", "What we owed {{name}} before", {
          name: openingFor?.name ?? "",
        })}
        okText={t("supplier.openingOk", "Save")}
        onCancel={() => setOpeningFor(null)}
        onOk={saveOpening}
      >
        <Form form={openForm} layout="vertical">
          <Form.Item
            name="amount"
            label={t("supplier.amount", "Amount")}
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
        </Form>
      </Modal>
    </PageContainer>
  );
}
