/**
 * Evaluation — every 👍 and 👎 staff gave a bot reply (owner ask 2026-10-15).
 *
 * Opens on "bad and still open", which is the review queue; the chips above
 * the table are those two filters and one × each takes them off. *Apply*
 * confirms (or rewrites) the better answer and files it where the bot reads
 * it back; *Dismiss* closes the row without teaching anything; *Open chat*
 * jumps to the conversation it came from.
 */
import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Tag,
  Typography,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  MessageOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ProTable, type ProColumn } from "../../components/ProTable";
import { LongText } from "../../components/LongText";
import { COLUMN } from "../../theme/tokens";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  applyEvaluation,
  deleteEvaluation,
  dismissEvaluation,
  listEvaluations,
  type Evaluation,
} from "../../lib/chatApi.js";
import { FunnelCard } from "./FunnelCard.js";
import {
  EVAL_STATUS_COLOR,
  agentLabel,
  evalStatusLabel,
  ratingLabel,
  reasonLabel,
} from "./labels.js";

export interface EvaluationPanelProps {
  /** Switch to the Chat tab with this thread open. */
  onOpenChat: (phone: string) => void;
}

export function EvaluationPanel({ onOpenChat }: EvaluationPanelProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<Evaluation | null>(null);
  const [corrected, setCorrected] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await listEvaluations({ status: "ALL" })).evaluations);
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.loadFailed", "Could not load the evaluations."),
      );
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openApply = (e: Evaluation) => {
    setCorrected(e.corrected ?? e.reply ?? "");
    setApplying(e);
  };

  const apply = async () => {
    if (!applying) return;
    const text = corrected.trim();
    if (!text) return;
    setBusy(applying.id);
    try {
      await applyEvaluation(applying.id, text);
      setApplying(null);
      message.success(
        t(
          "chatEval.applied",
          "Applied. The bot reads this answer from now on.",
        ),
      );
      await load();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.applyFailed", "Could not apply it."),
      );
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (e: Evaluation) => {
    setBusy(e.id);
    try {
      await dismissEvaluation(e.id);
      await load();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.dismissFailed", "Could not dismiss it."),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (e: Evaluation) => {
    setBusy(e.id);
    try {
      await deleteEvaluation(e.id);
      message.success(t("chatEval.deleted", "Rating deleted."));
      await load();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.deleteFailed", "Could not delete it."),
      );
    } finally {
      setBusy(null);
    }
  };

  const columns: ProColumn<Evaluation>[] = [
    {
      key: "date",
      title: t("chatEval.colDate", "Date"),
      dataIndex: "createdAt",
      width: COLUMN.date,
      defaultSortOrder: "descend",
      render: (v: string) => fmtDateTime(v),
    },
    {
      key: "phone",
      title: t("chatEval.colCustomer", "Customer"),
      dataIndex: "phone",
      width: COLUMN.code,
      searchable: true,
    },
    {
      key: "customerText",
      title: t("chatEval.colMessage", "Customer message"),
      dataIndex: "customerText",
      searchable: true,
      render: (v: string | null) => <LongText>{v}</LongText>,
    },
    {
      key: "reply",
      title: t("chatEval.colReply", "Bot reply"),
      dataIndex: "reply",
      searchable: true,
      render: (v: string | null) => <LongText>{v}</LongText>,
    },
    {
      key: "rating",
      title: t("chatEval.colRating", "Rating"),
      width: COLUMN.tag,
      facet: true,
      sortValue: (e) => e.rating,
      facetValue: (e) => ratingLabel(t, e.rating),
      render: (_: unknown, e: Evaluation) => (
        <Tag color={e.rating === "GOOD" ? "green" : "red"}>
          {ratingLabel(t, e.rating)}
        </Tag>
      ),
    },
    {
      key: "reason",
      title: t("chatEval.colReason", "Reason"),
      width: COLUMN.choice,
      facet: true,
      sortValue: (e) => (e.reason ? reasonLabel(t, e.reason) : undefined),
      facetValue: (e) => (e.reason ? reasonLabel(t, e.reason) : fmtNone()),
      render: (_: unknown, e: Evaluation) =>
        e.reason ? reasonLabel(t, e.reason) : fmtNone(),
    },
    {
      key: "agent",
      title: t("chatEval.colAgent", "Agent"),
      width: COLUMN.choice,
      facet: true,
      sortValue: (e) => (e.agent ? agentLabel(t, e.agent) : undefined),
      facetValue: (e) => (e.agent ? agentLabel(t, e.agent) : fmtNone()),
      render: (_: unknown, e: Evaluation) =>
        e.agent ? agentLabel(t, e.agent) : fmtNone(),
    },
    {
      key: "note",
      title: t("chatEval.colNote", "Note / better answer"),
      searchable: true,
      searchValue: (e) => [e.note, e.corrected].filter(Boolean).join(" "),
      render: (_: unknown, e: Evaluation) =>
        e.note || e.corrected ? (
          <Flex vertical gap={4}>
            {e.note && <Typography.Text>{e.note}</Typography.Text>}
            {e.corrected && (
              <Typography.Text type="secondary">
                <LongText>{e.corrected}</LongText>
              </Typography.Text>
            )}
          </Flex>
        ) : (
          fmtNone()
        ),
    },
    {
      key: "status",
      title: t("chatEval.colStatus", "Status"),
      width: COLUMN.status,
      facet: true,
      sortValue: (e) => e.status,
      facetValue: (e) => evalStatusLabel(t, e.status),
      render: (_: unknown, e: Evaluation) => (
        <Tag color={EVAL_STATUS_COLOR[e.status]}>
          {evalStatusLabel(t, e.status)}
        </Tag>
      ),
    },
    {
      key: "actions",
      title: t("chatEval.colActions", "Actions"),
      width: COLUMN.actionsPair,
      render: (_: unknown, e: Evaluation) => (
        <Flex vertical gap={4} align="flex-start">
          {e.status === "OPEN" && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={busy === e.id}
                onClick={() => openApply(e)}
              >
                {t("chatEval.apply", "Apply")}
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                disabled={busy === e.id}
                onClick={() => void dismiss(e)}
              >
                {t("chatEval.dismiss", "Dismiss")}
              </Button>
            </>
          )}
          <Button
            size="small"
            type="link"
            icon={<MessageOutlined />}
            style={{ paddingInline: 0 }}
            onClick={() => onOpenChat(e.phone)}
          >
            {t("chatEval.openChat", "Open chat")}
          </Button>
          <Popconfirm
            title={t("chatEval.deleteTitle", "Delete this rating?")}
            description={
              e.status === "APPLIED"
                ? t(
                    "chatEval.deleteAppliedBody",
                    "The answer it added to the Knowledge Base stays.",
                  )
                : undefined
            }
            okText={t("chatEval.deleteOk", "Delete")}
            okButtonProps={{ danger: true }}
            cancelText={t("common.cancel", "Cancel")}
            onConfirm={() => void remove(e)}
          >
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              style={{ paddingInline: 0 }}
              disabled={busy === e.id}
            >
              {t("chatEval.delete", "Delete")}
            </Button>
          </Popconfirm>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={16}>
      {/* Where the chats go, before what the bot said in them (2026-10-27). */}
      <FunnelCard onOpenChat={onOpenChat} />
      <Card>
        <ProTable<Evaluation>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          defaultFilters={{
            rating: [ratingLabel(t, "BAD")],
            status: [evalStatusLabel(t, "OPEN")],
          }}
          searchPlaceholder={t(
            "chatEval.search",
            "Search a number, a message or a note",
          )}
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("chatEval.reload", "Reload")}
            </Button>
          }
        />

        <Modal
          open={applying !== null}
          title={t("chatEval.applyTitle", "Apply the better answer")}
          okText={t("chatEval.apply", "Apply")}
          okButtonProps={{
            loading: busy !== null,
            disabled: !corrected.trim(),
          }}
          onOk={() => void apply()}
          onCancel={() => setApplying(null)}
          destroyOnHidden
        >
          <Flex vertical gap={10}>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("chatEval.whatTheBotSaid", "What the bot said")}
              </Typography.Text>
              <div style={{ whiteSpace: "pre-wrap" }}>
                {applying?.reply ?? fmtNone()}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("chatEval.betterAnswerLabel", "Better answer")}
              </Typography.Text>
              <Input.TextArea
                aria-label={t("chatEval.betterAnswerLabel", "Better answer")}
                autoSize={{ minRows: 3, maxRows: 10 }}
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
              />
            </div>
          </Flex>
        </Modal>
      </Card>
    </Flex>
  );
}
