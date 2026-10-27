/**
 * What the shop sent, inside the conversation (owner ask 2026-10-23: *"Display
 * the photo that we sent as well. Can we edit or unsend from the web? I would
 * want to do that in case the AI is wrong."*).
 *
 *  - `SentPhoto` draws a sent photo where it went out, small, and opens it
 *    larger on a click. A unit's QC photos are purged when it sells, so a
 *    photo that is no longer stored says so rather than drawing a broken
 *    image.
 *  - `SentMenu` is the ⋯ on a sent bubble: *Edit* while WhatsApp still allows
 *    it (a text, within 15 minutes) and *Unsend* (delete for everyone, within
 *    about two days) behind a confirm. Both limits — and whether the shop
 *    sends through the linked device at all — are the server's call
 *    (`canEdit` / `canUnsend`); this only draws what it was told is possible.
 *    Any signed-in staff may do either; the server logs who.
 */
import { useState } from "react";
import { App, Button, Dropdown, Image, Input, Modal, Typography } from "antd";
import { EllipsisOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  editSent,
  sentPhotoUrl,
  unsendSent,
  type SentItem,
} from "../../lib/inboxApi.js";

export function SentPhoto({ phone, item }: { phone: string; item: SentItem }) {
  const { t } = useTranslation();
  const [gone, setGone] = useState(false);
  if (gone) {
    return (
      <Typography.Text type="secondary" italic data-testid="sent-photo-gone">
        {t("chat.photoGone", "Photo no longer stored")}
      </Typography.Text>
    );
  }
  return (
    <Image
      src={sentPhotoUrl(phone, item.id)}
      width={160}
      alt={t("chat.sentPhoto", "Photo sent")}
      style={{ borderRadius: 8, objectFit: "cover" }}
      onError={() => setGone(true)}
    />
  );
}

export function SentMenu({
  phone,
  item,
  onChanged,
}: {
  phone: string;
  item: SentItem;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.body ?? "");
  const [saving, setSaving] = useState(false);

  const canEdit = item.canEdit && item.kind === "WA_REPLY";
  if (!canEdit && !item.canUnsend) return null;

  const errorText = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback;

  const unsend = () => {
    modal.confirm({
      title: t("chat.unsendTitle", "Unsend this message?"),
      content: t(
        "chat.unsendBody",
        "It is deleted for the customer too. They will see that a message was deleted.",
      ),
      okText: t("chat.unsend", "Unsend"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel", "Cancel"),
      onOk: async () => {
        try {
          await unsendSent(phone, item.id);
          message.success(t("chat.unsent", "Message unsent."));
          onChanged();
        } catch (err) {
          message.error(
            errorText(
              err,
              t("chat.unsendFailed", "Could not unsend the message."),
            ),
          );
        }
      },
    });
  };

  const save = async () => {
    const next = text.trim();
    if (!next) return;
    setSaving(true);
    try {
      await editSent(phone, item.id, next);
      message.success(t("chat.edited", "Message edited."));
      setEditing(false);
      onChanged();
    } catch (err) {
      message.error(
        errorText(err, t("chat.editFailed", "Could not edit the message.")),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            ...(canEdit
              ? [{ key: "edit", label: t("chat.editMessage", "Edit") }]
              : []),
            ...(item.canUnsend
              ? [
                  {
                    key: "unsend",
                    danger: true,
                    label: t("chat.unsend", "Unsend"),
                  },
                ]
              : []),
          ],
          onClick: ({ key }) => {
            if (key === "edit") {
              setText(item.body ?? "");
              setEditing(true);
            } else unsend();
          },
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<EllipsisOutlined />}
          aria-label={t("chat.messageActions", "Message actions")}
        />
      </Dropdown>
      <Modal
        open={editing}
        title={t("chat.editTitle", "Edit the message")}
        okText={t("chat.saveEdit", "Save")}
        cancelText={t("common.cancel", "Cancel")}
        confirmLoading={saving}
        okButtonProps={{
          disabled: !text.trim() || text.trim() === item.body,
        }}
        onOk={() => void save()}
        onCancel={() => setEditing(false)}
        destroyOnHidden
      >
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          aria-label={t("chat.editTitle", "Edit the message")}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t(
            "chat.editHint",
            "WhatsApp allows an edit for 15 minutes after sending. The customer sees it marked as edited.",
          )}
        </Typography.Text>
      </Modal>
    </>
  );
}
