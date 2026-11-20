/**
 * /audit — the chatbot audit (2026-11-18,
 * docs/superpowers/specs/2026-11-18-chatbot-audit-design.md). Widatech only:
 * App.tsx draws it for an account with `canViewAudit`, and the API refuses
 * the rest. A layout of its own — no shop navigation — because it is not a
 * shop screen: it reports how well the bot did last night.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Layout,
  Select,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "../../i18n/translate.js";
import { ProTable, type ProColumn } from "../../components/ProTable.js";
import { fmtDate, fmtDateTime } from "../../lib/format.js";
import {
  REVIEW_CATEGORIES,
  dollars,
  useDismissFlag,
  useReviewFlags,
  useReviewModel,
  useReviewRuns,
  useReviewThread,
  useSetReviewModel,
  type ReviewCategory,
  type ReviewFlag,
  type ReviewRun,
  type ReviewRunStatus,
  type ReviewSeverity,
} from "../../lib/auditApi.js";
import { SPACE } from "../../theme/tokens.js";

/** A category in words. Literal `t()` calls: the i18n test reads the source. */
export function categoryLabel(c: ReviewCategory, t: TFunction): string {
  switch (c) {
    case "WRONG_FACT":
      return t("audit.cat.wrongFact", "Wrong fact");
    case "UNANSWERED":
      return t("audit.cat.unanswered", "Not answered");
    case "HANDOVER":
      return t("audit.cat.handover", "Hand-over");
    case "RULE_BROKEN":
      return t("audit.cat.ruleBroken", "Rule broken");
    case "TONE":
      return t("audit.cat.tone", "Tone");
    case "MISSED_SALE":
      return t("audit.cat.missedSale", "Missed sale");
    case "OTHER":
      return t("audit.cat.other", "Other");
  }
}

function severityTag(s: ReviewSeverity, t: TFunction) {
  return s === "BAD" ? (
    <Tag color="red">{t("audit.sev.bad", "Bad")}</Tag>
  ) : (
    <Tag color="gold">{t("audit.sev.improve", "Could be better")}</Tag>
  );
}

function statusTag(s: ReviewRunStatus, t: TFunction) {
  switch (s) {
    case "RUNNING":
      return <Tag color="processing">{t("audit.run.running", "Running")}</Tag>;
    case "DONE":
      return <Tag color="success">{t("audit.run.done", "Done")}</Tag>;
    case "STOPPED":
      return <Tag color="warning">{t("audit.run.stopped", "Stopped")}</Tag>;
    case "FAILED":
      return <Tag color="error">{t("audit.run.failed", "Failed")}</Tag>;
  }
}

function LastNight({ run }: { run: ReviewRun | undefined }) {
  const { t } = useTranslation();
  if (!run)
    return (
      <Card title={t("audit.lastNight", "Last night")}>
        <Empty
          description={t(
            "audit.noRun",
            "No review has run yet. It runs every night between 01:00 and 05:00 WIB.",
          )}
        />
      </Card>
    );
  return (
    <Card
      title={t("audit.lastNight", "Last night")}
      extra={statusTag(run.status, t)}
    >
      {run.status === "FAILED" || run.status === "STOPPED" ? (
        <Alert
          type={run.status === "FAILED" ? "error" : "warning"}
          showIcon
          style={{ marginBottom: SPACE.md }}
          message={
            run.status === "FAILED"
              ? t("audit.failedTitle", "The review could not run")
              : t("audit.stoppedTitle", "The review stopped early")
          }
          description={run.reason}
        />
      ) : null}
      <Flex gap={SPACE.xl} wrap>
        <Statistic
          title={t("audit.started", "Started")}
          value={fmtDateTime(run.startedAt)}
        />
        <Statistic
          title={t("audit.chatsRead", "Chats read")}
          value={run.chats}
        />
        <Statistic
          title={t("audit.badFlags", "Bad")}
          value={run.byCategory.BAD ?? 0}
          valueStyle={{ color: "#cf1322" }}
        />
        <Statistic
          title={t("audit.improveFlags", "Could be better")}
          value={run.byCategory.IMPROVE ?? 0}
        />
        <Statistic
          title={t("audit.cost", "Cost")}
          value={dollars(run.costMicros)}
        />
        <Statistic title={t("audit.model", "Model")} value={run.model} />
      </Flex>
    </Card>
  );
}

/**
 * The reviewer's model (2026-11-20). The shop's setup token is refused
 * Sonnet 5.5, so the review failed every night until another model could be
 * picked here; the choice applies from the next run.
 */
function ReviewerModel() {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const setting = useReviewModel();
  const save = useSetReviewModel();
  const data = setting.data;
  return (
    <Card title={t("audit.reviewer", "Reviewer")}>
      <Flex vertical gap={SPACE.sm}>
        <Typography.Text>
          {t("audit.reviewerModel", "Reviewer model")}
        </Typography.Text>
        <Select
          aria-label={t("audit.reviewerModel", "Reviewer model")}
          style={{ width: "100%", maxWidth: 420 }}
          loading={setting.isPending || save.isPending}
          disabled={!data || save.isPending}
          value={data?.model}
          onChange={(model: string) =>
            save.mutate(model, {
              onSuccess: () =>
                void message.success(
                  t(
                    "audit.reviewerSaved",
                    "Saved. The next review uses this model.",
                  ),
                ),
              onError: (err) => void message.error(err.message),
            })
          }
          options={(data?.models ?? []).map((m) => ({
            value: m.id,
            label: (
              <Flex gap={SPACE.xs} align="center" wrap>
                {m.label}
                {m.id === data?.defaultModel ? (
                  <Tag>{t("audit.reviewerDefault", "Default")}</Tag>
                ) : null}
                {m.worksWithSetupToken ? (
                  <Tag color="green">
                    {t("audit.reviewerSetupToken", "Works with a setup token")}
                  </Tag>
                ) : null}
              </Flex>
            ),
          }))}
        />
        <Typography.Text type="secondary">
          {t(
            "audit.reviewerHint",
            "If the review fails because the token was refused, pick a model the token accepts. It runs every night between 01:00 and 05:00 WIB.",
          )}
        </Typography.Text>
      </Flex>
    </Card>
  );
}

function Trend({ runs }: { runs: readonly ReviewRun[] }) {
  const { t } = useTranslation();
  const rows = runs.slice(0, 30);
  return (
    <Card title={t("audit.trend", "Last 30 nights")}>
      <Table<ReviewRun>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: t("audit.noNights", "No nights yet.") }}
        columns={[
          {
            key: "night",
            title: t("audit.night", "Night"),
            render: (_: unknown, r) => fmtDate(r.startedAt),
          },
          {
            key: "status",
            title: t("audit.status", "Status"),
            render: (_: unknown, r) => statusTag(r.status, t),
          },
          {
            key: "chats",
            title: t("audit.chatsRead", "Chats read"),
            dataIndex: "chats",
            align: "right",
          },
          {
            key: "bad",
            title: t("audit.chatsWithBad", "Chats with a bad flag"),
            align: "right",
            render: (_: unknown, r) =>
              r.chats > 0
                ? `${r.chatsWithBad} (${Math.round((r.chatsWithBad / r.chats) * 100)}%)`
                : "0",
          },
          ...REVIEW_CATEGORIES.map((c) => ({
            key: c,
            title: categoryLabel(c, t),
            align: "right" as const,
            render: (_: unknown, r: ReviewRun) => r.byCategory[c] ?? 0,
          })),
        ]}
      />
    </Card>
  );
}

function ChatDrawer({
  threadId,
  focus,
  onClose,
}: {
  threadId: string | null;
  focus: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const thread = useReviewThread(threadId);
  const dismiss = useDismissFlag();
  const data = thread.data;
  const flagged = new Set(
    (data?.flags ?? []).map((f) => f.messageId).filter(Boolean),
  );
  const who = (w: "customer" | "bot" | "staff") =>
    w === "customer"
      ? t("audit.who.customer", "Customer")
      : w === "bot"
        ? t("audit.who.bot", "Bot")
        : t("audit.who.staff", "Staff");
  return (
    <Drawer
      open={threadId !== null}
      onClose={onClose}
      width={640}
      title={
        data
          ? `${t("audit.chat", "Chat")} ${data.thread.from}`
          : t("audit.chat", "Chat")
      }
    >
      {thread.isPending ? (
        <Spin />
      ) : data ? (
        <Flex vertical gap={SPACE.md}>
          {data.flags.map((f) => (
            <Card
              key={f.id}
              size="small"
              style={f.dismissedAt ? { opacity: 0.55 } : undefined}
              title={
                <Flex gap={SPACE.xs} align="center">
                  {severityTag(f.severity, t)}
                  {categoryLabel(f.category, t)}
                </Flex>
              }
              extra={
                <Button
                  size="small"
                  loading={dismiss.isPending}
                  onClick={() =>
                    dismiss.mutate({ id: f.id, dismiss: !f.dismissedAt })
                  }
                >
                  {f.dismissedAt
                    ? t("audit.undismiss", "Undo dismiss")
                    : t("audit.dismiss", "Dismiss")}
                </Button>
              }
            >
              <Typography.Paragraph style={{ marginBottom: SPACE.xs }}>
                “{f.quote}”
              </Typography.Paragraph>
              <Typography.Text type="secondary">{f.suggestion}</Typography.Text>
            </Card>
          ))}
          <Flex vertical gap={SPACE.xs} data-testid="audit-chat">
            {data.lines.map((l, i) => {
              const hot = l.who === "bot" && flagged.has(l.messageId);
              return (
                <div
                  key={`${l.messageId}-${i}`}
                  data-flagged={hot ? "true" : undefined}
                  style={{
                    padding: SPACE.sm,
                    borderRadius: 8,
                    background: hot
                      ? "rgba(250, 173, 20, 0.18)"
                      : l.who === "customer"
                        ? "rgba(0,0,0,0.04)"
                        : "rgba(4, 120, 87, 0.08)",
                    outline:
                      hot && focus === l.messageId
                        ? "2px solid #faad14"
                        : undefined,
                    alignSelf: l.who === "customer" ? "flex-start" : "flex-end",
                    maxWidth: "85%",
                  }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {who(l.who)} · {fmtDateTime(l.at)}
                  </Typography.Text>
                  <div style={{ whiteSpace: "pre-wrap" }}>{l.text}</div>
                </div>
              );
            })}
          </Flex>
        </Flex>
      ) : null}
    </Drawer>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runs = useReviewRuns();
  const flags = useReviewFlags();
  const [open, setOpen] = useState<{
    thread: string;
    message: string | null;
  } | null>(null);

  const columns = useMemo<ProColumn<ReviewFlag>[]>(
    () => [
      {
        key: "createdAt",
        title: t("audit.col.date", "Date"),
        dataIndex: "createdAt",
        dateRange: true,
        sorter: true,
        render: (v: string) => fmtDateTime(v),
      },
      {
        key: "category",
        title: t("audit.col.category", "Category"),
        facet: true,
        sortValue: (r) => r.category,
        facetValue: (r) => categoryLabel(r.category, t),
        render: (_: unknown, r) => categoryLabel(r.category, t),
      },
      {
        key: "severity",
        title: t("audit.col.severity", "Severity"),
        facet: true,
        sortValue: (r) => r.severity,
        facetValue: (r) =>
          r.severity === "BAD"
            ? t("audit.sev.bad", "Bad")
            : t("audit.sev.improve", "Could be better"),
        render: (_: unknown, r) => severityTag(r.severity, t),
      },
      {
        key: "quote",
        title: t("audit.col.quote", "What the bot said"),
        dataIndex: "quote",
        searchable: true,
        render: (v: string, r) => (
          <Typography.Text delete={r.dismissedAt !== null}>
            “{v}”
          </Typography.Text>
        ),
      },
      {
        key: "suggestion",
        title: t("audit.col.suggestion", "Suggestion"),
        dataIndex: "suggestion",
        searchable: true,
      },
      {
        key: "from",
        title: t("audit.col.chat", "Chat"),
        dataIndex: "from",
        searchable: true,
        render: (v: string, r) => (
          <Flex gap={SPACE.xs} align="center" wrap>
            {v}
            {r.tester ? <Tag>{t("audit.tester", "Tester")}</Tag> : null}
          </Flex>
        ),
      },
      {
        key: "dismissed",
        title: t("audit.col.state", "State"),
        facet: true,
        sortValue: (r) => (r.dismissedAt ? 1 : 0),
        facetValue: (r) =>
          r.dismissedAt
            ? t("audit.state.dismissed", "Dismissed")
            : t("audit.state.open", "Open"),
        render: (_: unknown, r) =>
          r.dismissedAt
            ? t("audit.state.dismissed", "Dismissed")
            : t("audit.state.open", "Open"),
      },
    ],
    [t],
  );

  const runList = runs.data?.runs ?? [];
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header
        style={{
          display: "flex",
          alignItems: "center",
          gap: SPACE.md,
          background: "transparent",
          paddingInline: SPACE.lg,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/stock/inventory")}
        >
          {t("audit.back", "Back to the POS")}
        </Button>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("audit.title", "Chatbot audit")}
        </Typography.Title>
      </Layout.Header>
      <Layout.Content style={{ padding: SPACE.lg }}>
        <Flex vertical gap={SPACE.lg}>
          {runs.isPending ? <Spin /> : <LastNight run={runList[0]} />}
          <ReviewerModel />
          {runList.length > 0 ? <Trend runs={runList} /> : null}
          <Card title={t("audit.flags", "Flags")}>
            <ProTable<ReviewFlag>
              lazy
              rowKey="id"
              loading={flags.isPending}
              dataSource={flags.data?.flags ?? []}
              columns={columns}
              searchPlaceholder={t(
                "audit.search",
                "Search what the bot said, a suggestion or a number",
              )}
              locale={{ emptyText: t("audit.noFlags", "No flags.") }}
              onRow={(r) => ({
                onClick: () =>
                  setOpen({ thread: r.threadId, message: r.messageId }),
                style: { cursor: "pointer" },
              })}
            />
          </Card>
        </Flex>
      </Layout.Content>
      <ChatDrawer
        threadId={open?.thread ?? null}
        focus={open?.message ?? null}
        onClose={() => setOpen(null)}
      />
    </Layout>
  );
}
