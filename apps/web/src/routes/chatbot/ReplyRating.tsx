/**
 * 👍 / 👎 under every bot reply (owner ask 2026-10-15). Replaces "Fix this".
 *
 * 👍 records GOOD at once — praise that costs a dialog is praise nobody
 * gives. 👎 asks why, which agent (when somebody knows), a note and the
 * better answer, prefilled with the bot's own text so a one-word fix is one
 * word of typing. A better answer identical to what was sent teaches nothing
 * and is left off. The row lands on the Evaluation tab, where applying it is
 * what the bot reads back.
 *
 * A rating can be taken back (owner ask 2026-10-27): the same thumb pressed
 * again withdraws it, and the other thumb replaces it — one request, so the
 * reply is never left with two verdicts. Only while it is OPEN: one that was
 * applied became a Knowledge Base answer, and the tooltip says to remove it
 * there. Its author or an owner may; the server says so to anybody else.
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
  EVALUATION_REASONS,
  createEvaluation,
  withdrawEvaluation,
  type EvaluationReason,
} from "../../lib/chatApi.js";
import type { ReplyEvaluation } from "../../lib/inboxApi.js";
import { EVAL_STATUS_COLOR, evalStatusLabel, reasonLabel } from "./labels.js";

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

  /** The rating standing now may be replaced or withdrawn: OPEN only. */
  const isOpen = evaluation?.status === "OPEN";
  const replaces = evaluation && isOpen ? { replaces: evaluation.id } : {};

  const withdraw = async () => {
    if (!evaluation) return;
    setBusy(true);
    try {
      await withdrawEvaluation(evaluation.id);
      message.success(t("chatEval.withdrawn", "Rating taken back."));
      onChanged();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatEval.withdrawFailed", "Could not take the rating back."),
      );
    } finally {
      setBusy(false);
    }
  };

  const good = async () => {
    if (evaluation?.rating === "GOOD") return withdraw();
    setBusy(true);
    try {
      await createEvaluation({ messageId, rating: "GOOD", ...replaces });
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
    if (evaluation?.rating === "BAD") {
      void withdraw();
      return;
    }
    form.setFieldsValue({
      reason: undefined,
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
            ...(note ? { note } : {}),
            ...(corrected && corrected !== text.trim() ? { corrected } : {}),
            ...replaces,
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

  // A decided rating stays as it is; the tooltip says why and where.
  const locked = evaluation !== null && !isOpen;
  const lockedHint =
    evaluation?.status === "APPLIED"
      ? t(
          "chatEval.appliedLocked",
          "This rating became a Knowledge Base answer — remove it there",
        )
      : t("chatEval.reviewedLocked", "This rating has already been reviewed");
  const hint = (rating: "GOOD" | "BAD") =>
    locked
      ? lockedHint
      : evaluation?.rating === rating
        ? t("chatEval.undoHint", "Press again to take the rating back")
        : rating === "GOOD"
          ? t("chatEval.goodHint", "A good reply")
          : t("chatEval.badHint", "A bad reply: say why");
  return (
    <>
      <Flex align="center" gap={2}>
        {/* The span carries the tooltip: a disabled button gets no pointer
            events, and a locked thumb is exactly when the hint matters. */}
        <Tooltip title={hint("GOOD")}>
          <span style={{ display: "inline-flex" }} data-testid="rate-good">
            <Button
              type="text"
              size="small"
              aria-label={t("chatEval.rateGood", "Good reply")}
              aria-pressed={evaluation?.rating === "GOOD"}
              icon={
                evaluation?.rating === "GOOD" ? (
                  <LikeFilled />
                ) : (
                  <LikeOutlined />
                )
              }
              disabled={locked || busy}
              onClick={() => void good()}
            />
          </span>
        </Tooltip>
        <Tooltip title={hint("BAD")}>
          <span style={{ display: "inline-flex" }} data-testid="rate-bad">
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
              disabled={locked || busy}
              onClick={openBad}
            />
          </span>
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
          {/* No "which agent": one agent answers since 2026-10-21. */}
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
