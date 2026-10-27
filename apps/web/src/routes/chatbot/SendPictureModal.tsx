/**
 * Send a picture that is NOT in the POS — from this computer or phone — to the
 * customer of the open chat (owner ask 2026-10-27).
 *
 * Pick a JPG, PNG or WebP of at most 5 MB, see it, add a caption if wanted,
 * and Send. Anything else is refused here, in the dialog and in words, before
 * a byte is uploaded; the server applies the same rules (and the 24-hour
 * window) and stores the picture as a `ChatMedia` row with the WA_IMAGE that
 * the worker sends — exactly as it sends a unit's QC photo.
 *
 * Not kept on this device: a picture is a file somebody picks again in two
 * clicks, and a 5 MB data URL does not belong in `localStorage`.
 */
import { useRef, useState } from "react";
import { Alert, App, Button, Flex, Input, Modal, Typography } from "antd";
import { PictureOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "../../lib/api.js";
import { sendPicture } from "../../lib/inboxApi.js";
import { SPACE } from "../../theme/tokens";

/** What WhatsApp and the server take — `inboxSent.ts` `PICTURE_TYPES`. */
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** `inboxSent.ts` `PICTURE_MAX_BYTES`. */
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
/** WhatsApp's limit on an image caption. */
export const CAPTION_MAX = 1_024;

/** Why a file cannot be sent, or null when it can. */
export function pictureProblem(file: {
  type: string;
  size: number;
}): "TYPE" | "SIZE" | "EMPTY" | null {
  if (!PICTURE_TYPES.includes(file.type)) return "TYPE";
  if (file.size === 0) return "EMPTY";
  if (file.size > PICTURE_MAX_BYTES) return "SIZE";
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SendPictureModal({
  phone,
  open,
  onClose,
  onSent,
}: {
  readonly phone: string | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSent: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const [picture, setPicture] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);

  const reset = () => {
    setPicture(null);
    setProblem(null);
    setCaption("");
    if (input.current) input.current.value = "";
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const why = pictureProblem(file);
    if (why) {
      setPicture(null);
      setProblem(
        why === "TYPE"
          ? t(
              "chat.pictureWrongType",
              "Only a JPG, PNG or WebP picture can be sent.",
            )
          : why === "SIZE"
            ? t(
                "chat.pictureTooBig",
                "The picture is larger than 5 MB. Pick a smaller one.",
              )
            : t("chat.pictureEmpty", "That file is empty."),
      );
      return;
    }
    try {
      setPicture({ name: file.name, url: await readAsDataUrl(file) });
      setProblem(null);
    } catch {
      setProblem(t("chat.pictureUnreadable", "That file could not be read."));
    }
  };

  const send = async () => {
    if (!phone || !picture) return;
    setSending(true);
    try {
      await sendPicture(phone, picture.url, caption.trim() || undefined);
      message.success(
        t(
          "chat.pictureQueued",
          "Picture queued. It goes out in a few seconds.",
        ),
      );
      reset();
      onSent();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setProblem(
          t(
            "chat.pictureWindowClosed",
            "The 24-hour window has closed, so WhatsApp would not deliver the picture.",
          ),
        );
      } else if (err instanceof ApiRequestError && err.status === 413) {
        setProblem(
          t(
            "chat.pictureTooBig",
            "The picture is larger than 5 MB. Pick a smaller one.",
          ),
        );
      } else if (err instanceof ApiRequestError && err.status === 415) {
        setProblem(
          t(
            "chat.pictureWrongType",
            "Only a JPG, PNG or WebP picture can be sent.",
          ),
        );
      } else {
        setProblem(
          err instanceof Error && err.message
            ? err.message
            : t("chat.pictureFailed", "Could not send the picture."),
        );
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("chat.pictureTitle", "Send a picture from this device")}
      okText={t("chat.send", "Send")}
      cancelText={t("common.cancel", "Cancel")}
      okButtonProps={{ disabled: !picture, loading: sending }}
      onOk={() => void send()}
      onCancel={() => {
        reset();
        onClose();
      }}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.sm}>
        <input
          ref={input}
          type="file"
          accept={PICTURE_TYPES.join(",")}
          aria-label={t("chat.pictureChoose", "Choose a picture")}
          style={{ display: "none" }}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button
          icon={<PictureOutlined />}
          onClick={() => input.current?.click()}
        >
          {picture
            ? t("chat.pictureChooseAnother", "Choose another picture")
            : t("chat.pictureChoose", "Choose a picture")}
        </Button>
        {problem && <Alert type="error" showIcon title={problem} />}
        {picture && (
          <img
            src={picture.url}
            alt={t("chat.picturePreview", "Picture to send")}
            style={{
              maxWidth: "100%",
              maxHeight: 320,
              objectFit: "contain",
              borderRadius: 8,
              alignSelf: "center",
            }}
          />
        )}
        <Input.TextArea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={CAPTION_MAX}
          autoSize={{ minRows: 2, maxRows: 5 }}
          aria-label={t("chat.pictureCaption", "Caption")}
          placeholder={t("chat.pictureCaptionHint", "Caption (optional)")}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("chat.pictureRules", "JPG, PNG or WebP, up to 5 MB.")}
        </Typography.Text>
      </Flex>
    </Modal>
  );
}
