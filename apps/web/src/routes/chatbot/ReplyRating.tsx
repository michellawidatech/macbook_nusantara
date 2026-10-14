/**
 * 👍 / 👎 under every bot reply (owner ask 2026-10-15). Replaces "Fix this".
 *
 * 👍 records GOOD at once — praise that costs a dialog is praise nobody
 * gives. 👎 asks why, which agent (when somebody knows), a note and the
 * better answer, prefilled with the bot's own text so a one-word fix is one
 * word of typing. A better answer identical to what was sent teaches nothing
 * and is left off. The row lands on the Evaluation tab, where applying it is
 * what the bot reads back.
 */
import { useState } from "react";
import {
  App,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip,
} from "antd";
import {
  DislikeFilled,
  DislikeOutlined,
  LikeFilled,
  LikeOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  AGENT_KEYS,
  EVALUATION_REASONS,
  createEvaluation,
  type AgentKey,
  type EvaluationReason,
} from "../../lib/chatApi.js";
import type { ReplyEvaluation } from "../../lib/inboxApi.js";
import {
  EVAL_STATUS_COLOR,
  agentLabel,
  evalStatusLabel,
  reasonLabel,
} from "./labels.js";

export interface ReplyRatingProps {
  /** The `WaMessage` the reply hangs off. */
  messageId: string;
  /** What the bot sent — the starting point of a better answer. */
  text: string;
  evaluation: ReplyEvaluation | null;
  /** Refetch the conversation after a write. */
  onChanged: () => void;
}

interface BadForm {
  reason: EvaluationReason;
  agent?: AgentKey;
  note?: string;
  corrected?: string;
}

export function ReplyRating({
  messageId,
  text,
  evaluation,
  onChanged,
}: ReplyRatingProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<BadForm>();

  const good = async () => {
    setBusy(true);
    try {
      await createEvaluation({ messageId, rating: "GOOD" });
      onChanged();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.saveFailed", "Could not save the rating."),
      );
    } finally {
      setBusy(false);
    }
  };

  const openBad = () => {
    form.setFieldsValue({
      reason: undefined,
      agent: undefined,
      note: "",
      corrected: text,
    });
    setOpen(true);
  };

  const saveBad = () =>
    form
      .validateFields()
      .then(async (v) => {
        setBusy(true);
        try {
          const note = v.note?.trim();
          const corrected = v.corrected?.trim();
          await createEvaluation({
            messageId,
            rating: "BAD",
            reason: v.reason,
            ...(v.agent ? { agent: v.agent } : {}),
            ...(note ? { note } : {}),
            ...(corrected && corrected !== text.trim() ? { corrected } : {}),
          });
          setOpen(false);
          message.success(
            t(
              "chatEval.badSaved",
              "Saved. It is on the Evaluation tab for review.",
            ),
          );
          onChanged();
        } catch (err) {
          message.error(
            err instanceof Error
              ? err.message
              : t("chatEval.saveFailed", "Could not save the rating."),
          );
        } finally {
          setBusy(false);
        }
      })
      // A refused form already shows its own message under the field.
      .catch(() => undefined);

  const rated = evaluation !== null;
  return (
    <>
      <Flex align="center" gap={2}>
        <Tooltip title={t("chatEval.goodHint", "A good reply")}>
          <Button
            type="text"
            size="small"
            aria-label={t("chatEval.rateGood", "Good reply")}
            aria-pressed={evaluation?.rating === "GOOD"}
            icon={
              evaluation?.rating === "GOOD" ? <LikeFilled /> : <LikeOutlined />
            }
            disabled={rated || busy}
            onClick={() => void good()}
          />
        </Tooltip>
        <Tooltip title={t("chatEval.badHint", "A bad reply: say why")}>
          <Button
            type="text"
            size="small"
            danger={evaluation?.rating === "BAD"}
            aria-label={t("chatEval.rateBad", "Bad reply")}
            aria-pressed={evaluation?.rating === "BAD"}
            icon={
              evaluation?.rating === "BAD" ? (
                <DislikeFilled />
              ) : (
                <DislikeOutlined />
              )
            }
            disabled={rated || busy}
            onClick={openBad}
          />
        </Tooltip>
        {evaluation?.rating === "BAD" && (
          <Tag
            color={EVAL_STATUS_COLOR[evaluation.status]}
            style={{ marginInline: 0 }}
          >
            {evalStatusLabel(t, evaluation.status)}
          </Tag>
        )}
      </Flex>

      <Modal
        open={open}
        title={t("chatEval.badTitle", "What was wrong with this reply?")}
        okText={t("chatEval.save", "Save")}
        okButtonProps={{ loading: busy }}
        onOk={() => void saveBad()}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item
            name="reason"
            label={t("chatEval.reason", "Reason")}
            rules={[
              {
                required: true,
                message: t("chatEval.reasonRequired", "Pick a reason."),
              },
            ]}
          >
            <Select
              aria-label={t("chatEval.reason", "Reason")}
              options={EVALUATION_REASONS.map((r) => ({
                value: r,
                label: reasonLabel(t, r),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="agent"
            label={t("chatEval.agentOptional", "Which agent (optional)")}
          >
            <Select
              allowClear
              aria-label={t("chatEval.agentOptional", "Which agent (optional)")}
              options={AGENT_KEYS.map((a) => ({
                value: a,
                label: agentLabel(t, a),
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label={t("chatEval.note", "Note")}>
            <Input aria-label={t("chatEval.note", "Note")} />
          </Form.Item>
          <Form.Item
            name="corrected"
            label={t("chatEval.betterAnswer", "Better answer (optional)")}
          >
            <Input.TextArea
              aria-label={t(
                "chatEval.betterAnswer",
                "Better answer (optional)",
              )}
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
