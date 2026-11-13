/**
 * The pieces every screen uses to ask instead of edit (2026-11-13).
 *
 *  - `ChangeRequestMenu` — the ⋯ in place of Edit / Delete for a person who
 *    cannot approve, with *Request edit* and *Request delete*.
 *  - `RequestNoteField` — the required "Why?" a dialog in request mode adds
 *    above its foot; its Save reads *Send request*.
 *  - `RequestDeleteModal` — *Request delete*: what would go, and why.
 *  - `ChangeRequestedTag` — "Change requested" on a record somebody asked
 *    about and nobody has decided yet.
 *
 * What the request carries is `sendChangeRequest` (lib/changeRequests.ts):
 * the dialog's own mutation, run on a copy.
 */
import { useState, type ReactNode } from "react";
import {
  App,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { ChangeRequest } from "../lib/changeRequestsApi.js";
import { NothingToRequestError } from "../lib/changeRequests.js";
import { ApiRequestError } from "../lib/api.js";
import { fmtDateTime } from "../lib/format.js";

export interface ChangeRequestMenuProps {
  /** Names the record for a screen reader: "More for SI-2026/11-000001". */
  readonly label: string;
  readonly onRequestEdit?: () => void;
  readonly onRequestDelete?: () => void;
  /** Why a delete cannot be asked for at all (the same reasons Delete has). */
  readonly deleteBlocked?: string;
  readonly editBlocked?: string;
  readonly size?: "small" | "middle";
}

export function ChangeRequestMenu({
  label,
  onRequestEdit,
  onRequestDelete,
  deleteBlocked,
  editBlocked,
  size = "small",
}: ChangeRequestMenuProps) {
  const { t } = useTranslation();
  const items = [
    ...(onRequestEdit
      ? [
          {
            key: "edit",
            icon: <EditOutlined />,
            disabled: editBlocked !== undefined,
            label:
              editBlocked === undefined ? (
                t("changeReq.requestEdit", "Request edit")
              ) : (
                <Tooltip title={editBlocked}>
                  <span>{t("changeReq.requestEdit", "Request edit")}</span>
                </Tooltip>
              ),
          },
        ]
      : []),
    ...(onRequestDelete
      ? [
          {
            key: "delete",
            icon: <DeleteOutlined />,
            danger: deleteBlocked === undefined,
            disabled: deleteBlocked !== undefined,
            label:
              deleteBlocked === undefined ? (
                t("changeReq.requestDelete", "Request delete")
              ) : (
                <Tooltip title={deleteBlocked}>
                  <span>{t("changeReq.requestDelete", "Request delete")}</span>
                </Tooltip>
              ),
          },
        ]
      : []),
  ];
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items,
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (key === "edit") onRequestEdit?.();
          if (key === "delete") onRequestDelete?.();
        },
      }}
    >
      <Button
        size={size}
        type="text"
        icon={<MoreOutlined />}
        aria-label={t("changeReq.menuAria", "Ask an approver about {{what}}", {
          what: label,
        })}
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}

export interface RequestNoteFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Turned on after a Send with the box empty. */
  readonly showError?: boolean;
}

/** The required "Why?" of a request. */
export function RequestNoteField({
  value,
  onChange,
  showError = false,
}: RequestNoteFieldProps) {
  const { t } = useTranslation();
  const missing = showError && value.trim() === "";
  return (
    <Form.Item
      label={t("changeReq.why", "Why?")}
      required
      validateStatus={missing ? "error" : undefined}
      help={
        missing
          ? t("changeReq.whyNeeded", "Say why — the approver reads this.")
          : t(
              "changeReq.whyHint",
              "An approver sees this with the change, and decides.",
            )
      }
      style={{ marginBottom: 0 }}
    >
      <Input.TextArea
        value={value}
        rows={2}
        maxLength={1000}
        aria-label={t("changeReq.whyAria", "Why this change is needed")}
        onChange={(e) => onChange(e.target.value)}
      />
    </Form.Item>
  );
}

/** What a failed request says, in words. */
export function requestFailedText(
  e: unknown,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (e instanceof NothingToRequestError)
    return t(
      "changeReq.nothing",
      "Nothing has changed, so there is nothing to ask.",
    );
  if (e instanceof ApiRequestError) return e.message;
  return t("changeReq.failed", "The request was not sent. Try again.");
}

export interface RequestDeleteModalProps {
  readonly open: boolean;
  readonly title: string;
  /** What would go, as the normal Delete's confirm says it. */
  readonly description: ReactNode;
  /** File the request; resolves when it is sent. */
  readonly onSend: (note: string) => Promise<unknown>;
  readonly onClose: () => void;
}

export function RequestDeleteModal({
  open,
  title,
  description,
  onSend,
  onClose,
}: RequestDeleteModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setTried(true);
    if (note.trim() === "") return;
    setSending(true);
    try {
      await onSend(note);
      message.success(
        t("changeReq.sent", "Request sent. An approver will decide."),
      );
      setNote("");
      setTried(false);
      onClose();
    } catch (e) {
      message.error(requestFailedText(e, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={t("changeReq.send", "Send request")}
      okButtonProps={{ loading: sending }}
      onOk={() => void send()}
      onCancel={() => {
        setNote("");
        setTried(false);
        onClose();
      }}
      destroyOnHidden
    >
      <Typography.Paragraph>{description}</Typography.Paragraph>
      <Form layout="vertical">
        <RequestNoteField value={note} onChange={setNote} showError={tried} />
      </Form>
    </Modal>
  );
}

/** "Change requested" on a record with a pending request. */
export function ChangeRequestedTag({
  requests,
}: {
  readonly requests: readonly ChangeRequest[];
}) {
  const { t } = useTranslation();
  if (requests.length === 0) return null;
  return (
    <Tooltip
      title={requests
        .map((r) =>
          t("changeReq.tagLine", "{{code}} · {{kind}} · {{name}}, {{when}}", {
            code: r.code,
            kind:
              r.kind === "DELETE"
                ? t("changeReq.kindDelete", "Delete")
                : t("changeReq.kindEdit", "Edit"),
            name: r.requestedBy.name,
            when: fmtDateTime(r.requestedAt),
          }),
        )
        .join("\n")}
    >
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>
        {t("changeReq.tag", "Change requested")}
      </Tag>
    </Tooltip>
  );
}
