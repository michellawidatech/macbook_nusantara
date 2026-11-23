/**
 * Financial & Report → Reconciliation (owner ask 2026-10-27, answers "1B 2B
 * 3B 4A"; docs/superpowers/specs/2026-10-27-reconciliation-design.md).
 *
 * Two tabs, each a log:
 *
 * - **Daily** — one row per day: the bank and the drawer, each POS · actual ·
 *   difference, the status, the note, who and when. *Reconcile* counts a day
 *   (`DailyReconcileModal`); a counted day can be reopened. A day whose POS
 *   balance has moved since it was counted reads *Changed since reconciled* —
 *   derived, nothing stored (answer 2B).
 * - **Monthly** — the bank's e-statement, uploaded (PDF or KlikBCA CSV), read
 *   and refused unless it adds up, then matched line by line
 *   (`MonthlyReconciliation`).
 *
 * Every row of either log can be DELETED (owner ask 2026-10-27): a day behind
 * a Popconfirm, a month behind a dialog and the month typed back, because it
 * holds the uploaded statement's lines and matches. `deleteReconciliation`
 * takes the record and everything hanging off it; corrections already made to
 * transactions stay, and the day or month reads as not reconciled again.
 *
 * Finance access only (answer 4A): a `/finance/*` path, so `App.tsx` answers
 * `FinanceLocked` for anybody else, and the API sends both collections only
 * to an account with `canViewFinance`.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Tabs,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import {
  CheckOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  DeleteOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import {
  fmtDate,
  fmtDateTime,
  fmtMonth,
  fmtNone,
  fmtRp,
} from "../../lib/format.js";
import { cashflowRows } from "../../lib/cashflowRows.js";
import {
  checkStatement,
  rupiahOf,
  senPartOf,
  statementTotals,
  StatementReadError,
  type ParsedStatement,
  type StatementProblem,
} from "../../lib/bankStatement.js";
import {
  dayBefore,
  deleteReconciliation,
  linesOf,
  monthCounts,
  monthRange,
  monthlyOf,
  posBalanceAt,
  potMovements,
  reopen,
  runMatching,
  toPosMovement,
  uploadStatement,
} from "../../lib/reconciliation.js";
import type { Reconciliation } from "../../mock/seed.js";
import { currentStaffName, mutate, nextId, useDb } from "../../mock/store.js";
import { COLUMN, SPACE } from "../../theme/tokens";
import type { TFunction } from "../../i18n/translate.js";
import {
  DailyPotModal,
  StartReconcileModal,
  potLabel,
  type PotToCount,
} from "./DailyReconcileModal";
import { MonthlyReconciliation } from "./MonthlyReconciliation";

/** A status in words, as literal `t()` calls. */
export function reconStatusLabel(
  s: Reconciliation["status"],
  t: TFunction,
): string {
  switch (s) {
    case "OPEN":
      return t("recon.statusOpen", "Open");
    case "MATCHED":
      return t("recon.statusMatched", "Matched");
    case "ADJUSTED":
      return t("recon.statusAdjusted", "Adjusted");
    case "RECONCILED":
      return t("recon.statusReconciled", "Reconciled");
  }
}

/** Why a statement was refused, line by line. */
function problemText(p: StatementProblem, t: TFunction): string {
  const rp = (sen: number) =>
    `${fmtRp(rupiahOf(sen))},${String(Math.abs(senPartOf(sen))).padStart(2, "0")}`;
  switch (p.code) {
    case "NO_LINES":
      return t("recon.problemNoLines", "The file holds no movements.");
    case "DOES_NOT_ADD_UP":
      return t(
        "recon.problemAddUp",
        "Opening + credits − debits comes to {{computed}}, but the statement closes at {{closing}}.",
        { computed: rp(p.computedSen), closing: rp(p.closingSen) },
      );
    case "CREDIT_TOTAL":
      return t(
        "recon.problemCreditTotal",
        "The credits add up to {{summed}}; the statement says {{stated}}.",
        { summed: rp(p.summedSen), stated: rp(p.statedSen) },
      );
    case "DEBIT_TOTAL":
      return t(
        "recon.problemDebitTotal",
        "The debits add up to {{summed}}; the statement says {{stated}}.",
        { summed: rp(p.summedSen), stated: rp(p.statedSen) },
      );
    case "CREDIT_COUNT":
      return t(
        "recon.problemCreditCount",
        "{{counted}} credits were read; the statement says {{stated}}.",
        { counted: p.counted, stated: p.stated },
      );
    case "DEBIT_COUNT":
      return t(
        "recon.problemDebitCount",
        "{{counted}} debits were read; the statement says {{stated}}.",
        { counted: p.counted, stated: p.stated },
      );
    case "BALANCE_BREAK":
      return t(
        "recon.problemBalance",
        "At line {{line}} the running balance should be {{expected}}; the statement prints {{printed}}.",
        {
          line: p.lineNo,
          expected: rp(p.expectedSen),
          printed: rp(p.printedSen),
        },
      );
  }
}

/** One day of the Daily log. */
interface DayRow {
  readonly day: string;
  readonly bank?: Reconciliation;
  readonly cash?: Reconciliation;
}

export function ReconciliationPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "monthly" ? "monthly" : "daily";
  const monthOpen = params.get("month");
  const [starting, setStarting] = useState(() => params.has("reconcile"));
  const [queue, setQueue] = useState<PotToCount[]>([]);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<
    { parsed: ParsedStatement; file: string } | undefined
  >();
  const [refused, setRefused] = useState<
    { file: string; problems: string[] } | undefined
  >();
  const [deletingMonth, setDeletingMonth] = useState<
    Reconciliation | undefined
  >();
  const [monthTyped, setMonthTyped] = useState("");

  const { token } = theme.useToken();
  const rows = useMemo(() => cashflowRows(db, t), [db, t]);
  const setParam = (patch: Record<string, string | undefined>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  // -------------------------------------------------------------------------
  // Daily
  // -------------------------------------------------------------------------

  const days = useMemo<DayRow[]>(() => {
    const by = new Map<
      string,
      { bank?: Reconciliation; cash?: Reconciliation }
    >();
    for (const r of db.reconciliations) {
      if (r.kind !== "DAILY") continue;
      const row = by.get(r.periodStart) ?? {};
      if (r.pot === "BANK") row.bank = r;
      else row.cash = r;
      by.set(r.periodStart, row);
    }
    return [...by.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [db.reconciliations]);

  /**
   * One pot of one day (owner ask 2026-11-23): a tick and the one amount when
   * the counted balance agrees with the POS as it stands NOW, otherwise a
   * cross and both figures. Judged against today's POS balance, not the one
   * saved at the count, so a day edited since it was reconciled simply reads
   * as not matching (the separate "Changed since reconciled" tag is gone).
   */
  const potCell = (rec: Reconciliation | undefined, day: string) => {
    if (rec === undefined) return fmtNone();
    const posNow = posBalanceAt(rows, db.settings, rec.pot, day);
    const pot = potLabel(rec.pot, t);
    if (rec.actualBalance === posNow)
      return (
        <Flex
          gap={6}
          align="center"
          data-testid={`pot-${rec.pot}-${day}`}
          aria-label={t("recon.potMatches", "{{pot}} matches", { pot })}
        >
          <CheckOutlined style={{ color: token.colorSuccess }} />
          <span>{fmtRp(rec.actualBalance)}</span>
        </Flex>
      );
    return (
      <Flex
        gap={6}
        align="start"
        data-testid={`pot-${rec.pot}-${day}`}
        aria-label={t("recon.potDiffers", "{{pot}} does not match", { pot })}
      >
        <CloseOutlined style={{ color: token.colorError, marginTop: 4 }} />
        <Flex vertical>
          <span>
            {t("recon.posShort", "POS")} {fmtRp(posNow)}
          </span>
          <span>
            {t("recon.actualShort", "Actual")} {fmtRp(rec.actualBalance)}
          </span>
        </Flex>
      </Flex>
    );
  };

  const openPot = (rec: Reconciliation) => {
    if (rec.status !== "OPEN")
      mutate((d) =>
        reopen(d, rec.id, {
          at: new Date().toISOString(),
          staff: currentStaffName(),
          nextId,
        }),
      );
    setQueue([
      { pot: rec.pot, day: rec.periodStart, actual: rec.actualBalance },
    ]);
  };

  const potButton = (rec: Reconciliation | undefined) =>
    rec === undefined ? null : (
      <Button size="small" onClick={() => openPot(rec)}>
        {rec.status === "OPEN"
          ? t("recon.continuePot", "Continue {{pot}}", {
              pot: potLabel(rec.pot, t),
            })
          : t("recon.reopenPot", "Reopen {{pot}}", {
              pot: potLabel(rec.pot, t),
            })}
      </Button>
    );

  const deleteDay = (r: DayRow) => {
    const ids = [r.bank?.id, r.cash?.id].filter(
      (x): x is string => x !== undefined,
    );
    mutate((d) => {
      for (const id of ids) deleteReconciliation(d, id);
    });
    message.success(
      t("recon.dayDeleted", "Reconciliation of {{day}} deleted.", {
        day: fmtDate(r.day),
      }),
    );
  };

  const monthKey = (r: Reconciliation) => r.periodStart.slice(0, 7);

  const confirmDeleteMonth = () => {
    const doomed = deletingMonth;
    if (doomed === undefined || monthTyped.trim() !== monthKey(doomed)) return;
    mutate((d) => {
      deleteReconciliation(d, doomed.id);
    });
    setDeletingMonth(undefined);
    setMonthTyped("");
    message.success(
      t("recon.monthDeleted", "Reconciliation of {{month}} deleted.", {
        month: fmtMonth(doomed.periodStart),
      }),
    );
  };

  const dailyTab = (
    <Card>
      <ProTable<DayRow>
        lazy
        persistKey="reconciliation.daily"
        rowKey="day"
        dataSource={days}
        searchPlaceholder={t("recon.searchNote", "Search a note")}
        columns={[
          {
            title: t("finance.date", "Date"),
            dataIndex: "day",
            width: COLUMN.date,
            defaultSortOrder: "descend",
            sortValue: (r: DayRow) => r.day,
            dateRange: true,
            dateValue: (r: DayRow) => `${r.day}T12:00:00`,
            render: (v: string) => fmtDate(v),
          },
          {
            title: t("recon.bank", "Bank"),
            key: "bank",
            width: 220,
            render: (_: unknown, r: DayRow) => potCell(r.bank, r.day),
          },
          {
            title: t("recon.cash", "Cash"),
            key: "cash",
            width: 220,
            render: (_: unknown, r: DayRow) => potCell(r.cash, r.day),
          },
          {
            title: t("recon.note", "Note"),
            key: "note",
            searchable: true,
            searchValue: (r: DayRow) =>
              [r.bank?.note, r.cash?.note].filter(Boolean).join(" "),
            render: (_: unknown, r: DayRow) =>
              [r.bank?.note, r.cash?.note].filter(Boolean).join(" · ") ||
              fmtNone(),
          },
          {
            key: "actions",
            width: COLUMN.actionsPair,
            render: (_: unknown, r: DayRow) => (
              <Flex vertical gap={4} align="start">
                {potButton(r.bank)}
                {potButton(r.cash)}
                <Popconfirm
                  title={t(
                    "recon.deleteDayTitle",
                    "Delete the reconciliation of {{day}}?",
                    { day: fmtDate(r.day) },
                  )}
                  description={t(
                    "recon.deleteKeepsCorrections",
                    "Corrections already made to transactions stay.",
                  )}
                  okText={t("recon.delete", "Delete")}
                  okButtonProps={{ danger: true }}
                  cancelText={t("common.cancel", "Cancel")}
                  onConfirm={() => deleteDay(r)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    {t("recon.delete", "Delete")}
                  </Button>
                </Popconfirm>
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  // -------------------------------------------------------------------------
  // Monthly
  // -------------------------------------------------------------------------

  const months = useMemo(
    () =>
      db.reconciliations
        .filter((r) => r.kind === "MONTHLY")
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
    [db.reconciliations],
  );

  const read = async (file: File) => {
    setReading(true);
    try {
      const { readStatementFile } =
        await import("../../lib/bankStatementPdf.js");
      const parsed = await readStatementFile(file);
      const problems = checkStatement(parsed);
      if (problems.length > 0) {
        setRefused({
          file: file.name,
          problems: problems.map((p) => problemText(p, t)),
        });
        return;
      }
      setPreview({ parsed, file: file.name });
    } catch (e) {
      setRefused({
        file: file.name,
        problems: [
          e instanceof StatementReadError
            ? t(
                "recon.notAStatement",
                "This does not read as a BCA e-statement or a KlikBCA mutasi download.",
              )
            : t("recon.unreadable", "The file could not be read."),
        ],
      });
    } finally {
      setReading(false);
    }
  };

  const previewMonth = preview?.parsed.periodStart.slice(0, 7);
  const previewExisting =
    previewMonth === undefined ? undefined : monthlyOf(db, previewMonth);
  const previewPos = useMemo(() => {
    if (previewMonth === undefined) return undefined;
    const { start, end } = monthRange(previewMonth);
    return {
      opening: posBalanceAt(rows, db.settings, "BANK", dayBefore(start)),
      closing: posBalanceAt(rows, db.settings, "BANK", end),
    };
  }, [previewMonth, rows, db.settings]);

  const confirmUpload = () => {
    if (preview === undefined || previewMonth === undefined || !previewPos)
      return;
    const p = preview.parsed;
    let id = "";
    mutate((d) => {
      const ctx = {
        at: new Date().toISOString(),
        staff: currentStaffName(),
        nextId,
      };
      id = uploadStatement(
        d,
        {
          month: previewMonth,
          file: preview.file,
          opening: rupiahOf(p.openingSen),
          closing: rupiahOf(p.closingSen),
          posOpening: previewPos.opening,
          posClosing: previewPos.closing,
          lines: p.lines.map((l) => ({
            lineNo: l.lineNo,
            date: l.date,
            description: l.description,
            amount: rupiahOf(l.amountSen),
            ...(l.balanceSen === undefined
              ? {}
              : { balance: rupiahOf(l.balanceSen) }),
          })),
        },
        ctx,
      );
      const { start, end } = monthRange(previewMonth);
      runMatching(
        d,
        id,
        potMovements(cashflowRows(d, t), d.settings, "BANK", start, end)
          .map(toPosMovement)
          .filter((m) => m !== undefined),
        nextId,
      );
    });
    setPreview(undefined);
    message.success(t("recon.uploaded", "Statement read and matched."));
    setParam({ tab: "monthly", month: previewMonth });
  };

  const openMonth = monthOpen ? monthlyOf(db, monthOpen) : undefined;

  const monthlyTab = openMonth ? (
    <MonthlyReconciliation
      recId={openMonth.id}
      onBack={() => setParam({ month: undefined })}
    />
  ) : (
    <Card>
      <ProTable<Reconciliation>
        lazy
        persistKey="reconciliation.monthly"
        rowKey="id"
        dataSource={months}
        search={false}
        columns={[
          {
            title: t("recon.month", "Month"),
            dataIndex: "periodStart",
            width: COLUMN.code,
            render: (v: string) => fmtMonth(v),
          },
          {
            title: t("recon.statementOpenClose", "Statement opening / closing"),
            key: "statement",
            render: (_: unknown, r: Reconciliation) => (
              <Flex vertical>
                <span>{fmtRp(r.statementOpening)}</span>
                <span>{fmtRp(r.statementClosing)}</span>
              </Flex>
            ),
          },
          {
            title: t("recon.posOpenClose", "POS opening / closing"),
            key: "pos",
            render: (_: unknown, r: Reconciliation) => (
              <Flex vertical>
                <span>
                  {fmtRp(
                    posBalanceAt(
                      rows,
                      db.settings,
                      "BANK",
                      dayBefore(r.periodStart),
                    ),
                  )}
                </span>
                <span>
                  {fmtRp(posBalanceAt(rows, db.settings, "BANK", r.periodEnd))}
                </span>
              </Flex>
            ),
          },
          {
            title: t("recon.linesState", "Matched · fixed · left"),
            key: "counts",
            width: COLUMN.status + 40,
            render: (_: unknown, r: Reconciliation) => {
              const c = monthCounts(linesOf(db, r.id));
              return `${c.matched} · ${c.fixed} · ${c.left}`;
            },
          },
          {
            title: t("finance.status", "Status"),
            dataIndex: "status",
            width: COLUMN.status,
            render: (v: Reconciliation["status"]) => (
              <Tag color={v === "RECONCILED" ? "green" : "orange"}>
                {reconStatusLabel(v, t)}
              </Tag>
            ),
          },
          {
            title: t("recon.who", "Who"),
            key: "who",
            width: COLUMN.choice,
            render: (_: unknown, r: Reconciliation) => (
              <Flex vertical>
                <span>{r.staff}</span>
                <Typography.Text type="secondary">
                  {fmtDateTime(r.updatedAt)}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            key: "actions",
            width: COLUMN.actionsPair,
            render: (_: unknown, r: Reconciliation) => (
              <Flex vertical gap={4} align="start">
                <Button
                  size="small"
                  onClick={() => setParam({ month: monthKey(r) })}
                >
                  {t("recon.openMonth", "Open")}
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setMonthTyped("");
                    setDeletingMonth(r);
                  }}
                >
                  {t("recon.delete", "Delete")}
                </Button>
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  const parsed = preview?.parsed;
  const totals = parsed ? statementTotals(parsed.lines) : undefined;
  const withSen = parsed
    ? parsed.lines.filter((l) => senPartOf(l.amountSen) !== 0).length
    : 0;

  return (
    <PageContainer
      title={t("finance.reconciliation", "Reconciliation")}
      stickyHeader
      actions={
        tab === "daily"
          ? [
              {
                key: "reconcile",
                label: t("recon.reconcile", "Reconcile"),
                icon: <CheckSquareOutlined />,
                type: "primary",
                onClick: () => setStarting(true),
              },
            ]
          : []
      }
      extra={
        tab === "monthly" ? (
          <Upload
            accept=".pdf,.csv,application/pdf,text/csv"
            showUploadList={false}
            beforeUpload={(file) => {
              void read(file);
              return false;
            }}
          >
            <Button type="primary" icon={<UploadOutlined />} loading={reading}>
              {t("recon.uploadStatement", "Upload bank statement")}
            </Button>
          </Upload>
        ) : undefined
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(k) =>
          setParam({
            tab: k === "monthly" ? "monthly" : undefined,
            month: undefined,
          })
        }
        items={[
          {
            key: "daily",
            label: t("recon.daily", "Daily"),
            children: dailyTab,
          },
          {
            key: "monthly",
            label: t("recon.monthly", "Monthly"),
            children: monthlyTab,
          },
        ]}
      />

      <StartReconcileModal
        open={starting}
        onClose={() => {
          setStarting(false);
          if (params.has("reconcile")) setParam({ reconcile: undefined });
        }}
        onMismatch={setQueue}
      />
      <DailyPotModal
        count={queue[0]}
        onClose={() => setQueue((q) => q.slice(1))}
      />

      <Modal
        open={deletingMonth !== undefined}
        title={t(
          "recon.deleteMonthTitle",
          "Delete the reconciliation of {{month}}?",
          { month: deletingMonth ? fmtMonth(deletingMonth.periodStart) : "" },
        )}
        okText={t("recon.delete", "Delete")}
        okButtonProps={{
          danger: true,
          disabled:
            deletingMonth === undefined ||
            monthTyped.trim() !== monthKey(deletingMonth),
        }}
        cancelText={t("common.cancel", "Cancel")}
        onOk={confirmDeleteMonth}
        onCancel={() => setDeletingMonth(undefined)}
        destroyOnHidden
      >
        <Flex vertical gap={SPACE.sm}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t(
              "recon.deleteMonthBody",
              "This removes the uploaded statement, its lines and matches, the notes set against it and its log.",
            )}{" "}
            {t(
              "recon.deleteKeepsCorrections",
              "Corrections already made to transactions stay.",
            )}
          </Typography.Paragraph>
          <Typography.Text>
            {t("recon.deleteTypeIt", "Type")}{" "}
            <Typography.Text code>
              {deletingMonth ? monthKey(deletingMonth) : ""}
            </Typography.Text>{" "}
            {t("recon.deleteToConfirm", "to confirm.")}
          </Typography.Text>
          <Input
            value={monthTyped}
            onChange={(e) => setMonthTyped(e.target.value)}
            aria-label={t("recon.deleteTypeAria", "Type the month to confirm")}
            placeholder={deletingMonth ? monthKey(deletingMonth) : ""}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onPressEnter={confirmDeleteMonth}
          />
        </Flex>
      </Modal>

      <Modal
        open={refused !== undefined}
        title={t("recon.refusedTitle", "This statement was not taken")}
        onCancel={() => setRefused(undefined)}
        footer={
          <Button onClick={() => setRefused(undefined)}>
            {t("common.close", "Close")}
          </Button>
        }
      >
        <Typography.Paragraph>{refused?.file}</Typography.Paragraph>
        <ul>
          {refused?.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={preview !== undefined}
        title={t("recon.previewTitle", "Bank statement — {{month}}", {
          month: parsed ? fmtMonth(parsed.periodStart) : "",
        })}
        okText={
          previewExisting
            ? t("recon.replaceAndMatch", "Replace the lines and match")
            : t("recon.readAndMatch", "Match against the POS")
        }
        onOk={confirmUpload}
        onCancel={() => setPreview(undefined)}
        width={640}
        destroyOnHidden
      >
        {parsed && totals && previewPos && (
          <Flex vertical gap={SPACE.sm}>
            <Alert
              type="success"
              showIcon
              title={t(
                "recon.addsUp",
                "{{n}} movements read — {{cr}} credits and {{db}} debits — and the statement adds up.",
                {
                  n: parsed.lines.length,
                  cr: totals.creditCount,
                  db: totals.debitCount,
                },
              )}
            />
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t("recon.period", "Period")}>
                {fmtDate(parsed.periodStart)} – {fmtDate(parsed.periodEnd)}
              </Descriptions.Item>
              <Descriptions.Item
                label={t("recon.statementOpening", "Statement opening")}
              >
                {fmtRp(rupiahOf(parsed.openingSen))}
              </Descriptions.Item>
              <Descriptions.Item label={t("recon.posOpening", "POS opening")}>
                {fmtRp(previewPos.opening)}
              </Descriptions.Item>
              <Descriptions.Item
                label={t("recon.statementClosing", "Statement closing")}
              >
                {fmtRp(rupiahOf(parsed.closingSen))}
              </Descriptions.Item>
              <Descriptions.Item label={t("recon.posClosing", "POS closing")}>
                {fmtRp(previewPos.closing)}
              </Descriptions.Item>
            </Descriptions>
            {rupiahOf(parsed.openingSen) !== previewPos.opening && (
              <Alert
                type="warning"
                showIcon
                title={t(
                  "recon.openingOffShort",
                  "The opening differs from the POS by {{diff}} — an earlier month is off.",
                  {
                    diff: fmtRp(
                      rupiahOf(parsed.openingSen) - previewPos.opening,
                    ),
                  },
                )}
              />
            )}
            {withSen > 0 && (
              <Typography.Text type="secondary">
                {t(
                  "recon.senNote",
                  "{{n}} line(s) carry sen. Amounts are kept to the rupiah as printed; the sen were checked and are not carried.",
                  { n: withSen },
                )}
              </Typography.Text>
            )}
            {previewExisting && (
              <Alert
                type="info"
                showIcon
                title={t(
                  "recon.replaces",
                  "This month already has a statement. Its lines and matches are replaced; corrections already made stay.",
                )}
              />
            )}
          </Flex>
        )}
      </Modal>
    </PageContainer>
  );
}
