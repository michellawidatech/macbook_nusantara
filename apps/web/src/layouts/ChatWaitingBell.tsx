/**
 * "🔔 3 chats need a reply" on every page (owner, 2026-10-28) — in the
 * sidebar's foot on a desktop, in the top bar on a phone. Nothing at zero.
 * A press opens the chat that has waited longest.
 *
 * Instagram comments count too (2026-11-16): "2 chats and 1 comment need a
 * reply", and with only comments waiting a press opens the Comments tab.
 */
import { Badge, Button, Tooltip } from "antd";
import { BellFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  useChatWaiting,
  waitingTotal,
  type ChatWaiting,
} from "../hooks/useChatWaiting.js";
import type { TFunction } from "../i18n/translate.js";
import { WEIGHT } from "../theme/tokens";

/**
 * What waits, in words — the bell's label and the Chatbot leaf's. Literal
 * `t()` calls, so test/i18n.test.ts can find every one.
 */
export function waitingLabel(t: TFunction, w: ChatWaiting): string {
  if (w.count > 0 && w.comments > 0)
    return t(
      "chatWaiting.chatsAndComments",
      "{{chats}} chat(s) and {{comments}} comment(s) need a reply",
      { chats: w.count, comments: w.comments },
    );
  if (w.comments > 0)
    return t("chatWaiting.comments", "{{count}} comment(s) need a reply", {
      count: w.comments,
    });
  return t("chatWaiting.label", "{{count}} chat(s) need a reply", {
    count: w.count,
  });
}

/** Where a press goes: the oldest chat, else the Comments tab. */
export function waitingTarget(w: ChatWaiting): string {
  if (w.count > 0)
    return w.oldest ? `/chat?phone=${encodeURIComponent(w.oldest)}` : "/chat";
  return w.comments > 0 ? "/chat?tab=comments" : "/chat";
}

export function ChatWaitingBell({
  rail = false,
  onOpen,
}: {
  /** The sidebar folded to icons: the bell and a count, no words. */
  readonly rail?: boolean;
  readonly onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const waiting = useChatWaiting();
  const total = waitingTotal(waiting);
  if (total === 0) return null;
  const label = waitingLabel(t, waiting);
  const open = () => {
    navigate(waitingTarget(waiting));
    onOpen?.();
  };
  return (
    <Tooltip title={rail ? label : ""} placement="right">
      <Badge count={rail ? total : 0} size="small" offset={[-4, 4]}>
        <Button
          block={!rail}
          danger
          type="primary"
          icon={<BellFilled />}
          aria-label={label}
          data-testid="chat-waiting-bell"
          onClick={open}
          style={{
            fontWeight: WEIGHT.strong,
            // "2 chats and 1 comment need a reply" is longer than the column:
            // it wraps rather than running out of the button.
            ...(rail
              ? {}
              : { whiteSpace: "normal", height: "auto", minHeight: 32 }),
          }}
        >
          {rail ? null : label}
        </Button>
      </Badge>
    </Tooltip>
  );
}
