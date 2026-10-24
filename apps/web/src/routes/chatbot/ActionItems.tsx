/**
 * The words and colours for the bot's hand-over tasks (`ChatAction`), and the
 * budget line — shared by the customer profile panel.
 *
 * ⚠️ The task dialog that opened by itself, its "Send offer" form and the
 * one-line strip under the conversation header were REMOVED on 2026-10-15
 * (owner: "do not display [the pop-up], instead just highlight the unanswered
 * chat"). A handed-over message is now outlined in the conversation
 * (ChatPage.tsx), Mark handled sits in the header, and a staff reply closes
 * the thread's open tasks (apps/api routes/inbox.ts).
 */
import { Tag } from "antd";
import type { TFunction } from "../../i18n/translate.js";
import { useTranslation } from "react-i18next";
import { fmtNone, fmtRp } from "../../lib/format.js";
import type { ChatActionKind } from "../../lib/inboxApi.js";

/** "Rp a – Rp b", one figure, or None. */
export function budgetText(min: string | null, max: string | null): string {
  if (min && max && min !== max)
    return `${fmtRp(Number(min))} – ${fmtRp(Number(max))}`;
  const one = min ?? max;
  return one ? fmtRp(Number(one)) : fmtNone();
}

export function actionKindLabel(t: TFunction, kind: ChatActionKind): string {
  switch (kind) {
    case "NEGOTIATION":
      return t("chatAction.negotiation", "Negotiation");
    case "PRICE":
      return t("chatAction.price", "Price");
    case "STOCK":
      return t("chatAction.stock", "Stock");
    case "RESERVATION":
      return t("chatAction.reservation", "Booking");
    case "PHOTOS":
      return t("chatAction.photos", "Photos");
    default:
      return t("chatAction.other", "Needs you");
  }
}

const KIND_COLOR: Record<ChatActionKind, string> = {
  NEGOTIATION: "magenta",
  PRICE: "gold",
  STOCK: "blue",
  RESERVATION: "cyan",
  PHOTOS: "purple",
  OTHER: "volcano",
};

export function ActionKindTag({ kind }: { kind: ChatActionKind }) {
  const { t } = useTranslation();
  return (
    <Tag color={KIND_COLOR[kind]} style={{ marginInline: 0 }}>
      {actionKindLabel(t, kind)}
    </Tag>
  );
}
