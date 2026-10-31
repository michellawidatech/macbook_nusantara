/**
 * One month of the bank against its e-statement (owner ask 2026-10-27,
 * answer 3B: "every line"). The statement is read and checked on upload
 * (`ReconciliationPage`); this is what is done with it.
 *
 * Top to bottom, in the order somebody works:
 *
 * 1. **The opening check.** SALDO AWAL against the POS's bank balance the day
 *    before the month began. A difference here is not this month's — an
 *    earlier month is off — so it is said first, before anybody spends an
 *    hour hunting it among this month's lines.
 * 2. **Suggestions**, each with its reason (`lib/bankMatch.ts`), Accept or
 *    Reject. Accepting a typo corrects the POS record; a deduction records
 *    the fee as an expense; a split or a merge just pairs.
 * 3. **Every line** of the statement, with what it is matched to; a line
 *    nothing explains can be added to the POS (category guessed from its
 *    words), paired by hand, or set aside with a note.
 * 4. **POS-only movements** — money the POS says went through the bank that
 *    the bank never saw. Open the record to correct or delete it, pair it, or
 *    set it aside with a note saying why (owner-approved 2026-10-27: a month
 *    is reconciled only once each is paired or explained). An aside shows its
 *    note, who and when, and Undo withdraws it; pairing the movement later
 *    withdraws it by itself (`withdrawPairedAsides`).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import {
  fmtDate,
  fmtDateTime,
  fmtMonth,
  fmtNone,
  fmtRp,
} from "../../lib/format.js";
import { accountOfMethod } from "../../lib/accounts.js";
import { cashflowRows, type CashflowRow } from "../../lib/cashflowRows.js";
import {
  guessCategory,
  type CategoryGuess,
  type SuggestionReason,
} from "../../lib/bankMatch.js";
import {
  addMatch,
  applyAmountEdit,
  asideFor,
  confirmLines,
  dayBefore,
  editBlock,
  editRows,
  heldSuggestions,
  ignoreLine,
  linesOf,
  localDay,
  logEdits,
  matchKey,
  matchedKeys,
  monthBlockers,
  monthCounts,
  pairManually,
  posBalanceAt,
  potMovements,
  rejectSuggestion,
  rowRefKey,
  runMatching,
  setAside,
  signedAmount,
  toPosMovement,
  unmatchLine,
  withdrawAside,
  withdrawPairedAsides,
  type HeldSuggestion,
  type MonthBlockers,
} from "../../lib/reconciliation.js";
import type { MockDb, StatementLineRec } from "../../mock/seed.js";
import { currentStaffName, mutate, nextId, useDb } from "../../mock/store.js";
import { COLUMN, SPACE } from "../../theme/tokens";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { labelOf } from "../../i18n/enumLabels.js";
import {
  EXPENSE_KIND_LABEL,
  INCOME_REASON_LABEL,
} from "../../lib/cashflowRows.js";
import type { TFunction } from "../../i18n/translate.js";
import {
  AdjustmentPanel,
  type AdjustmentPreset,
  type RecordedAdjustment,
} from "./AdjustmentPanel";
import { EditLog, editBlockText, itemsOfOrder } from "./DailyReconcileModal";

/** A suggestion's name, as literal `t()` calls. */
export function reasonLabel(reason: string, t: TFunction): string {
  switch (reason) {
    case "EXACT":
      return t("recon.reasonExact", "Same amount, same day");
    case "DATE_SHIFT":
      return t("recon.reasonDateShift", "Same amount, posted later");
    case "TYPO":
      return t("recon.reasonTypo", "Typo");
    case "DEDUCTION":
      return t("recon.reasonDeduction", "Deduction");
    case "SPLIT":
      return t("recon.reasonSplit", "One bank line, several POS movements");
    case "MERGE":
      return t("recon.reasonMerge", "Several bank lines, one POS movement");
    case "ADDED":
      return t("recon.reasonAdded", "Added to the POS");
    default:
      return t("recon.reasonManual", "Paired by hand");
  }
}

/** A line's status, in words. */
export function lineStatusLabel(
  status: StatementLineRec["status"],
  t: TFunction,
): string {
  switch (status) {
    case "MATCHED":
      return t("recon.lineMatched", "Matched");
    case "SUGGESTED":
      return t("recon.lineSuggested", "Suggestion");
    case "IGNORED":
      return t("recon.lineIgnored", "Set aside");
    case "UNMATCHED":
      return t("recon.lineUnmatched", "Not matched");
  }
}

const LINE_COLOUR: Record<StatementLineRec["status"], string> = {
  MATCHED: "green",
  SUGGESTED: "gold",
  IGNORED: "default",
  UNMATCHED: "red",
};

/** What a bank-only line will be added as, in words. */
function guessText(guess: CategoryGuess | undefined, t: TFunction): string {
  if (guess === undefined) return t("recon.guessNone", "Category not guessed");
  if (guess.direction === "MOVE")
    return guess.reason === "CASH_TO_BANK"
      ? t("adjust.cashToBank", "Setor Tunai ke Bank (cash → bank)")
      : t("adjust.bankToCash", "Pencairan Dana Bank (bank → cash)");
  return guess.direction === "INCOME"
    ? labelOf(INCOME_REASON_LABEL, guess.reason, t)
    : labelOf(EXPENSE_KIND_LABEL, guess.reason, t);
}

/** Where a POS record is opened to be corrected or deleted. */
function screenOf(r: CashflowRow): string {
  switch (r.source?.kind) {
    case "salePayment":
    case "refund":
      return "/finance/transactions";
    case "poPayment":
      return `/inbound/${r.source.poId}`;
    case "deposit":
      return "/suppliers";
    case "openingPayment":
      return "/customers";
    default:
      return "/finance/income-expense";
  }
}

const signedRp = (n: number) => (n < 0 ? `−${fmtRp(-n)}` : `+${fmtRp(n)}`);

/** Why *Mark the month reconciled* is disabled, in words; undefined when it is not. */
export function closeBlockedText(
  b: MonthBlockers,
  t: TFunction,
): string | undefined {
  if (b.noLines)
    return t("recon.blockNoLines", "Upload the bank statement first");
  const parts: string[] = [];
  if (b.lines > 0)
    parts.push(
      t(
        "recon.blockLines",
        "{{n}} statement line(s) still to match or set aside",
        { n: b.lines },
      ),
    );
  if (b.posOnly > 0)
    parts.push(
      t(
        "recon.blockPosOnly",
        "{{n}} POS entries never reached the bank — pair or explain them",
        { n: b.posOnly },
      ),
    );
  return parts.length === 0 ? undefined : parts.join("; ");
}

export function MonthlyReconciliation({
  recId,
  onBack,
}: {
  recId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const { compact } = useLayoutMode();
  const rec = db.reconciliations.find((r) => r.id === recId);
  const rows = useMemo(() => cashflowRows(db, t), [db, t]);
  const lines = useMemo(() => linesOf(db, recId), [db, recId]);

  const [pairing, setPairing] = useState<
    { lineIds: string[]; keys: string[] } | undefined
  >();
  const [ignoring, setIgnoring] = useState<string | undefined>();
  const [ignoreNote, setIgnoreNote] = useState("");
  /** The POS-only movement being set aside, by its key. */
  const [asiding, setAsiding] = useState<string | undefined>();
  const [asideNote, setAsideNote] = useState("");
  const [adding, setAdding] = useState<
    { line: StatementLineRec; preset: AdjustmentPreset } | undefined
  >();

  if (rec === undefined) return null;
  const start = rec.periodStart;
  const end = rec.periodEnd;
  const closed = rec.status === "RECONCILED";
  const posOpening = posBalanceAt(rows, db.settings, "BANK", dayBefore(start));
  const posClosing = posBalanceAt(rows, db.settings, "BANK", end);
  // A deduction's row is folded into its payment, which matches net.
  const movements = potMovements(rows, db.settings, "BANK", start, end).filter(
    (r) => r.feeOf === undefined,
  );
  const byKey = new Map<string, CashflowRow>();
  for (const r of rows) {
    const k = rowRefKey(r);
    if (k !== undefined) byKey.set(k, r);
  }
  const taken = matchedKeys(lines);
  const posOnly = movements.filter((r) => !taken.has(rowRefKey(r) ?? ""));
  const held = heldSuggestions(lines);
  const counts = monthCounts(lines);
  const blockers = monthBlockers(
    lines,
    posOnly.map(rowRefKey).filter((k) => k !== undefined),
    rec,
  );
  const blockedText = closeBlockedText(blockers, t);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const openingDiff = (rec.statementOpening ?? 0) - posOpening;
  const closingDiff = (rec.statementClosing ?? 0) - posClosing;
  const ctx = () => ({
    at: new Date().toISOString(),
    staff: currentStaffName(),
    nextId,
  });
  /**
   * Every mutation that can pair a movement goes through here, so an aside
   * on a movement the statement turns out to show is withdrawn with it.
   */
  const mutatePairing = (fn: (d: MockDb) => void) =>
    mutate((d) => {
      fn(d);
      withdrawPairedAsides(d, recId, new Date().toISOString());
    });

  /** A wider window than the month for pairing by hand: postings lag. */
  const pairable = potMovements(
    rows,
    db.settings,
    "BANK",
    dayBefore(dayBefore(dayBefore(start))),
    end,
  ).filter((r) => r.feeOf === undefined);

  const describe = (r: CashflowRow | undefined) =>
    r === undefined
      ? fmtNone()
      : [
          fmtDate(localDay(r.at)),
          r.orderCode,
          r.description,
          r.source?.kind === "salePayment"
            ? itemsOfOrder(db, r.source.orderId)
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ");

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  const whatToDo = (s: HeldSuggestion): string => {
    const line = lineById.get(s.lineIds[0]!);
    const move = byKey.get(s.movementKeys[0]!);
    switch (s.reason as SuggestionReason) {
      case "TYPO":
        return t("recon.doTypo", "Correct the POS amount to {{amount}}", {
          amount: fmtRp(Math.abs(line?.amount ?? 0)),
        });
      case "DEDUCTION":
        return t("recon.doDeduction", "Record {{amount}} as a fee (expense)", {
          amount: fmtRp((move ? signedAmount(move) : 0) - (line?.amount ?? 0)),
        });
      case "SPLIT":
        return t(
          "recon.doSplit",
          "These {{n}} POS movements add up to this bank line",
          { n: s.movementKeys.length },
        );
      case "MERGE":
        return t(
          "recon.doMerge",
          "These {{n}} bank lines add up to this POS movement",
          { n: s.lineIds.length },
        );
    }
  };

  const accept = (s: HeldSuggestion) => {
    const line = lineById.get(s.lineIds[0]!)!;
    const move = byKey.get(s.movementKeys[0]!);
    if (s.reason === "TYPO") {
      if (move?.source === undefined) return;
      const block = editBlock(db, move.source, Math.abs(line.amount));
      if (block !== undefined) {
        message.error(editBlockText(block, t));
        return;
      }
      mutatePairing((d) => {
        const c = ctx();
        const edits = applyAmountEdit(
          d,
          move.source!,
          Math.abs(line.amount),
          c,
        );
        logEdits(d, recId, editRows(edits, [], c), c);
        confirmLines(d, s.lineIds);
      });
      message.success(t("recon.typoFixed", "POS amount corrected."));
      return;
    }
    if (s.reason === "DEDUCTION") {
      if (move === undefined) return;
      const fee = signedAmount(move) - line.amount;
      mutatePairing((d) => {
        const c = ctx();
        const id = nextId("e");
        d.expenses.unshift({
          id,
          // A bank's or a marketplace's fee (owner 2026-10-27).
          kind: "BIAYA_ADMIN",
          label: t("recon.feeLabel", "Fee deducted — {{what}}", {
            what: move.orderCode ?? move.description,
          }),
          amount: fee,
          date: line.date,
          createdAt: c.at,
          method: "TRANSFER",
        });
        addMatch(d, line.id, { expenseId: id }, "DEDUCTION", nextId);
        logEdits(
          d,
          recId,
          editRows([], [{ ref: { expenseId: id }, amount: fee }], c),
          c,
        );
        confirmLines(d, s.lineIds);
      });
      message.success(t("recon.feeRecorded", "Fee recorded as an expense."));
      return;
    }
    mutatePairing((d) => confirmLines(d, s.lineIds));
    message.success(t("recon.paired", "Matched."));
  };

  // -------------------------------------------------------------------------
  // Lines
  // -------------------------------------------------------------------------

  const startAdd = (line: StatementLineRec) => {
    const guess = guessCategory(line.description, line.amount);
    setAdding({
      line,
      preset: {
        direction: guess?.direction ?? (line.amount > 0 ? "INCOME" : "EXPENSE"),
        reason: guess?.reason ?? "",
        date: line.date,
        amount: Math.abs(line.amount),
        method: "TRANSFER",
        note: line.description,
      },
    });
  };

  const recorded = (written: RecordedAdjustment[]) => {
    const target = adding?.line;
    if (target === undefined || written.length === 0) return;
    const pick =
      written.find((w) => accountOfMethod(w.method) === "BANK") ?? written[0]!;
    const ref =
      pick.kind === "expense" ? { expenseId: pick.id } : { incomeId: pick.id };
    mutatePairing((d) => {
      const c = ctx();
      addMatch(d, target.id, ref, "ADDED", nextId);
      logEdits(d, recId, editRows([], [{ ref, amount: pick.amount }], c), c);
    });
  };

  const pairSum = (pairing?.keys ?? []).reduce(
    (n, k) => n + (byKey.has(k) ? signedAmount(byKey.get(k)!) : 0),
    0,
  );
  const pairLineSum = (pairing?.lineIds ?? []).reduce(
    (n, id) => n + (lineById.get(id)?.amount ?? 0),
    0,
  );

  return (
    <Flex vertical gap={SPACE.md}>
      <Flex align="center" gap={SPACE.sm} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          {t("recon.allMonths", "All months")}
        </Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("recon.monthTitle", "Bank statement — {{month}}", {
            month: fmtMonth(start),
          })}
        </Typography.Title>
        <Tag color={closed ? "green" : "orange"}>
          {closed
            ? t("recon.statusReconciled", "Reconciled")
            : t("recon.statusOpen", "Open")}
        </Tag>
        {rec.statementFile && (
          <Typography.Text type="secondary">
            {rec.statementFile}
          </Typography.Text>
        )}
      </Flex>

      {openingDiff !== 0 && (
        <Alert
          type="warning"
          showIcon
          title={t(
            "recon.openingOff",
            "The statement opens at {{statement}} and the POS at {{pos}} — {{diff}} apart. An earlier month is off; reconcile it first.",
            {
              statement: fmtRp(rec.statementOpening ?? 0),
              pos: fmtRp(posOpening),
              diff: fmtRp(openingDiff),
            },
          )}
        />
      )}

      <Card size="small">
        <Flex gap={SPACE.lg} wrap>
          <Figure
            label={t("recon.statementOpening", "Statement opening")}
            value={fmtRp(rec.statementOpening ?? 0)}
          />
          <Figure
            label={t("recon.posOpening", "POS opening")}
            value={fmtRp(posOpening)}
            testId="month-pos-opening"
          />
          <Figure
            label={t("recon.statementClosing", "Statement closing")}
            value={fmtRp(rec.statementClosing ?? 0)}
          />
          <Figure
            label={t("recon.posClosing", "POS closing")}
            value={fmtRp(posClosing)}
            testId="month-pos-closing"
          />
          <Figure
            label={t("recon.difference", "Difference")}
            value={fmtRp(closingDiff)}
            danger={closingDiff !== 0}
          />
          <Figure
            label={t("recon.linesState", "Matched · fixed · left")}
            value={`${counts.matched} · ${counts.fixed} · ${counts.left}`}
            testId="month-counts"
          />
        </Flex>
        <Flex gap={SPACE.sm} wrap style={{ marginTop: SPACE.md }}>
          {closed ? (
            <Button
              onClick={() =>
                mutate((d) => {
                  const r = d.reconciliations.find((x) => x.id === recId);
                  if (!r) return;
                  r.status = "OPEN";
                  r.staff = currentStaffName();
                  r.updatedAt = new Date().toISOString();
                })
              }
            >
              {t("recon.reopen", "Reopen")}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => {
                  mutatePairing((d) => {
                    const fresh = cashflowRows(d, t);
                    runMatching(
                      d,
                      recId,
                      potMovements(fresh, d.settings, "BANK", start, end)
                        .map(toPosMovement)
                        .filter((m) => m !== undefined),
                      nextId,
                    );
                  });
                }}
              >
                {t("recon.matchAgain", "Match again")}
              </Button>
              <Tooltip title={blockedText}>
                <Button
                  type="primary"
                  disabled={blockedText !== undefined}
                  onClick={() =>
                    mutate((d) => {
                      const r = d.reconciliations.find((x) => x.id === recId);
                      if (!r) return;
                      r.status = "RECONCILED";
                      r.posBalance = posClosing;
                      r.staff = currentStaffName();
                      r.updatedAt = new Date().toISOString();
                    })
                  }
                >
                  {t("recon.markReconciled", "Mark the month reconciled")}
                </Button>
              </Tooltip>
              {blockedText !== undefined && (
                <Typography.Text
                  type="secondary"
                  data-testid="month-close-blocked"
                  style={{ alignSelf: "center" }}
                >
                  {blockedText}
                </Typography.Text>
              )}
            </>
          )}
        </Flex>
      </Card>

      {held.length > 0 && (
        <Card
          size="small"
          title={t("recon.suggestions", "Suggestions ({{n}})", {
            n: held.length,
          })}
        >
          <Table<HeldSuggestion>
            size="small"
            pagination={false}
            rowKey={(s) => s.lineIds.join("+")}
            dataSource={held}
            columns={[
              {
                title: t("recon.reason", "Reason"),
                key: "reason",
                width: COLUMN.status + 40,
                render: (_: unknown, s) => (
                  <Tag color="gold">{reasonLabel(s.reason, t)}</Tag>
                ),
              },
              {
                title: t("recon.bankSide", "Bank"),
                key: "bank",
                render: (_: unknown, s) => (
                  <Flex vertical>
                    {s.lineIds.map((id) => {
                      const l = lineById.get(id);
                      return l ? (
                        <span key={id}>
                          {fmtDate(l.date)} · {l.description} ·{" "}
                          <b>{signedRp(l.amount)}</b>
                        </span>
                      ) : null;
                    })}
                  </Flex>
                ),
              },
              {
                title: t("recon.posSide", "POS"),
                key: "pos",
                render: (_: unknown, s) => (
                  <Flex vertical>
                    {s.movementKeys.map((k) => {
                      const r = byKey.get(k);
                      return (
                        <span key={k}>
                          {describe(r)} ·{" "}
                          <b>{r ? signedRp(signedAmount(r)) : fmtNone()}</b>
                        </span>
                      );
                    })}
                  </Flex>
                ),
              },
              {
                title: t("recon.whatToDo", "What to do"),
                key: "do",
                width: 240,
                render: (_: unknown, s) => whatToDo(s),
              },
              {
                key: "actions",
                width: COLUMN.actionsWide - 40,
                render: (_: unknown, s) => (
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      disabled={closed}
                      onClick={() => accept(s)}
                    >
                      {t("recon.accept", "Accept")}
                    </Button>
                    <Button
                      size="small"
                      disabled={closed}
                      onClick={() =>
                        mutate((d) => rejectSuggestion(d, s.lineIds))
                      }
                    >
                      {t("recon.reject", "Reject")}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card size="small" title={t("recon.statementLines", "Statement lines")}>
        <ProTable<StatementLineRec>
          lazy
          rowKey="id"
          dataSource={lines}
          searchPlaceholder={t(
            "recon.searchLines",
            "Search a description or an amount",
          )}
          columns={[
            {
              title: t("recon.no", "No."),
              dataIndex: "lineNo",
              width: COLUMN.qty - 30,
              sortValue: (l: StatementLineRec) => l.lineNo,
              defaultSortOrder: "ascend",
            },
            {
              title: t("finance.date", "Date"),
              dataIndex: "date",
              width: COLUMN.date,
              render: (v: string) => fmtDate(v),
            },
            {
              title: t("finance.description", "Description"),
              dataIndex: "description",
              searchable: true,
            },
            {
              title: t("finance.amount", "Amount"),
              key: "amount",
              width: COLUMN.money,
              align: "right",
              searchable: true,
              searchValue: (l: StatementLineRec) => String(Math.abs(l.amount)),
              sortValue: (l: StatementLineRec) => l.amount,
              render: (_: unknown, l: StatementLineRec) => (
                <Typography.Text type={l.amount < 0 ? "danger" : "success"}>
                  {signedRp(l.amount)}
                </Typography.Text>
              ),
            },
            {
              title: t("finance.status", "Status"),
              key: "status",
              width: COLUMN.status,
              facet: true,
              facetLabel: t("finance.status", "Status"),
              facetValue: (l: StatementLineRec) => lineStatusLabel(l.status, t),
              render: (_: unknown, l: StatementLineRec) => (
                <Tag color={LINE_COLOUR[l.status]}>
                  {lineStatusLabel(l.status, t)}
                </Tag>
              ),
            },
            {
              title: t("recon.matchedTo", "Matched to"),
              key: "matches",
              render: (_: unknown, l: StatementLineRec) =>
                l.status === "IGNORED" ? (
                  <Typography.Text type="secondary">{l.note}</Typography.Text>
                ) : l.matches.length === 0 ? (
                  l.status === "UNMATCHED" ? (
                    <Typography.Text type="secondary">
                      {guessText(guessCategory(l.description, l.amount), t)}
                    </Typography.Text>
                  ) : (
                    fmtNone()
                  )
                ) : (
                  <Flex vertical>
                    {l.matches.map((m) => (
                      <span key={m.id}>
                        {describe(byKey.get(matchKey(m)))}{" "}
                        <Tag>{reasonLabel(m.reason, t)}</Tag>
                      </span>
                    ))}
                  </Flex>
                ),
            },
            {
              key: "actions",
              width: COLUMN.actionsWide + 40,
              render: (_: unknown, l: StatementLineRec) =>
                closed ? null : l.status === "UNMATCHED" ? (
                  <Space size={4} wrap>
                    <Button size="small" onClick={() => startAdd(l)}>
                      {t("recon.addToPos", "Add to POS")}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setPairing({ lineIds: [l.id], keys: [] })}
                    >
                      {t("recon.pair", "Pair")}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setIgnoreNote("");
                        setIgnoring(l.id);
                      }}
                    >
                      {t("recon.ignore", "Set aside")}
                    </Button>
                  </Space>
                ) : l.status === "SUGGESTED" ? null : (
                  <Button
                    size="small"
                    onClick={() => mutate((d) => unmatchLine(d, l.id))}
                  >
                    {t("recon.undo", "Undo")}
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title={t("recon.posOnly", "In the POS, not on the statement ({{n}})", {
          n: posOnly.length,
        })}
      >
        <Table<CashflowRow>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={posOnly}
          locale={{
            emptyText: t(
              "recon.posOnlyNone",
              "Every POS bank movement this month is on the statement.",
            ),
          }}
          columns={[
            {
              title: t("finance.date", "Date"),
              key: "date",
              width: COLUMN.date,
              render: (_: unknown, r) => fmtDate(localDay(r.at)),
            },
            {
              title: t("finance.transactionId", "Transaction ID"),
              key: "code",
              width: COLUMN.code,
              render: (_: unknown, r) => r.orderCode ?? fmtNone(),
            },
            {
              title: t("finance.description", "Description"),
              key: "description",
              render: (_: unknown, r) => r.description,
            },
            {
              title: t("finance.amount", "Amount"),
              key: "amount",
              width: COLUMN.money,
              align: "right",
              render: (_: unknown, r) => signedRp(signedAmount(r)),
            },
            {
              title: t("recon.explained", "Explained"),
              key: "aside",
              render: (_: unknown, r) => {
                const key = rowRefKey(r);
                const aside =
                  key === undefined ? undefined : asideFor(rec, key);
                if (aside === undefined) return fmtNone();
                return (
                  <Flex vertical data-testid={`aside-${key}`}>
                    <span>
                      <Tag>{t("recon.setAsideTag", "Set aside")}</Tag>
                      {aside.note}
                    </span>
                    <Typography.Text type="secondary">
                      {t("recon.asideBy", "{{who}} · {{when}}", {
                        who: aside.staff,
                        when: fmtDateTime(aside.at),
                      })}
                    </Typography.Text>
                  </Flex>
                );
              },
            },
            {
              key: "actions",
              width: COLUMN.actionsWide + 40,
              render: (_: unknown, r) => {
                const key = rowRefKey(r);
                const aside =
                  key === undefined ? undefined : asideFor(rec, key);
                return (
                  <Space size={4} wrap>
                    {!closed && key !== undefined && (
                      <Button
                        size="small"
                        onClick={() => setPairing({ lineIds: [], keys: [key] })}
                      >
                        {t("recon.pair", "Pair")}
                      </Button>
                    )}
                    {!closed && key !== undefined && aside === undefined && (
                      <Button
                        size="small"
                        onClick={() => {
                          setAsideNote("");
                          setAsiding(key);
                        }}
                      >
                        {t("recon.setAside", "Set aside with a note")}
                      </Button>
                    )}
                    {!closed && aside !== undefined && (
                      <Button
                        size="small"
                        onClick={() =>
                          mutate((d) =>
                            withdrawAside(
                              d,
                              recId,
                              aside.id,
                              new Date().toISOString(),
                            ),
                          )
                        }
                      >
                        {t("recon.undo", "Undo")}
                      </Button>
                    )}
                    <Link to={screenOf(r)}>
                      {t("recon.openRecord", "Open")}
                    </Link>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      {rec.edits.length > 0 && (
        <Card
          size="small"
          title={t(
            "recon.whatChanged",
            "What this reconciliation changed ({{n}})",
            {
              n: rec.edits.length,
            },
          )}
        >
          <EditLog db={db} edits={rec.edits} />
        </Card>
      )}

      <Modal
        open={pairing !== undefined}
        title={t("recon.pairTitle", "Pair by hand")}
        okText={t("recon.pair", "Pair")}
        okButtonProps={{
          disabled:
            (pairing?.lineIds.length ?? 0) === 0 ||
            (pairing?.keys.length ?? 0) === 0,
        }}
        onCancel={() => setPairing(undefined)}
        onOk={() => {
          if (pairing === undefined) return;
          mutatePairing((d) =>
            pairManually(d, pairing.lineIds, pairing.keys, nextId),
          );
          setPairing(undefined);
          message.success(t("recon.paired", "Matched."));
        }}
        width={compact ? "100%" : 720}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label={t("recon.bankLines", "Bank lines")}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              aria-label={t("recon.bankLines", "Bank lines")}
              value={pairing?.lineIds ?? []}
              onChange={(ids: string[]) =>
                setPairing((p) => (p ? { ...p, lineIds: ids } : p))
              }
              options={lines
                .filter(
                  (l) =>
                    l.status === "UNMATCHED" ||
                    (pairing?.lineIds ?? []).includes(l.id),
                )
                .map((l) => ({
                  value: l.id,
                  label: `${l.lineNo}. ${fmtDate(l.date)} · ${signedRp(l.amount)} · ${l.description}`,
                }))}
            />
          </Form.Item>
          <Form.Item label={t("recon.posMovements", "POS movements")}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              aria-label={t("recon.posMovements", "POS movements")}
              value={pairing?.keys ?? []}
              onChange={(keys: string[]) =>
                setPairing((p) => (p ? { ...p, keys } : p))
              }
              options={pairable
                .filter((r) => {
                  const k = rowRefKey(r);
                  return (
                    k !== undefined &&
                    (!taken.has(k) || (pairing?.keys ?? []).includes(k))
                  );
                })
                .map((r) => ({
                  value: rowRefKey(r)!,
                  label: `${describe(r)} · ${signedRp(signedAmount(r))}`,
                }))}
            />
          </Form.Item>
        </Form>
        {pairing !== undefined && pairLineSum !== pairSum && (
          <Alert
            type="info"
            showIcon
            title={t(
              "recon.pairDiffers",
              "The bank says {{bank}} and the POS {{pos}}. Pairing does not change either; correct the record if the POS is wrong.",
              { bank: signedRp(pairLineSum), pos: signedRp(pairSum) },
            )}
          />
        )}
      </Modal>

      <Modal
        open={ignoring !== undefined}
        title={t("recon.ignoreTitle", "Set this line aside")}
        okText={t("recon.ignore", "Set aside")}
        okButtonProps={{ disabled: ignoreNote.trim() === "" }}
        onCancel={() => setIgnoring(undefined)}
        onOk={() => {
          if (ignoring === undefined) return;
          mutate((d) => ignoreLine(d, ignoring, ignoreNote));
          setIgnoring(undefined);
        }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item
            required
            label={t("recon.ignoreWhy", "Why does the POS not need this line?")}
          >
            <Input.TextArea
              rows={2}
              value={ignoreNote}
              aria-label={t(
                "recon.ignoreWhy",
                "Why does the POS not need this line?",
              )}
              onChange={(e) => setIgnoreNote(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={asiding !== undefined}
        title={t("recon.setAsideTitle", "Set this entry aside")}
        okText={t("recon.setAsideOk", "Set aside")}
        okButtonProps={{ disabled: asideNote.trim() === "" }}
        onCancel={() => setAsiding(undefined)}
        onOk={() => {
          if (asiding === undefined || asideNote.trim() === "") return;
          mutate((d) => setAside(d, recId, asiding, asideNote, ctx()));
          setAsiding(undefined);
        }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item
            required
            label={t("recon.setAsideWhy", "Why did the bank never see it?")}
          >
            <Input.TextArea
              rows={2}
              value={asideNote}
              aria-label={t(
                "recon.setAsideWhy",
                "Why did the bank never see it?",
              )}
              onChange={(e) => setAsideNote(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <AdjustmentPanel
        addOpen={adding !== undefined}
        onCloseAdd={() => setAdding(undefined)}
        showHistory={false}
        {...(adding ? { preset: adding.preset } : {})}
        onRecorded={recorded}
      />
    </Flex>
  );
}

function Figure({
  label,
  value,
  danger,
  testId,
}: {
  label: string;
  value: string;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <Flex vertical>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Text
        strong
        type={danger ? "danger" : undefined}
        data-testid={testId}
      >
        {value}
      </Typography.Text>
    </Flex>
  );
}
