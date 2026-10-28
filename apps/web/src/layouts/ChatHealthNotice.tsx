/**
 * "⚠️ Chatbot has a problem" on every page (owner, 2026-10-28: "a constant
 * check if the chatbot is not running, and then notify in POS"). Polls
 * `GET /api/inbox/health` once a minute for the whole app, beside the
 * chats-waiting notice; nothing when all is well. The same check messages the
 * alert numbers on WhatsApp from the server.
 */
import { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import { WarningFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getChatHealth, type ChatHealth } from "../lib/chatApi.js";
import { WEIGHT } from "../theme/tokens";

export const HEALTH_POLL_MS = 60_000;

let current: ChatHealth | null = null;
const listeners = new Set<(h: ChatHealth | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    current = await getChatHealth();
    for (const l of listeners) l(current);
  } catch {
    // Keep the last answer: one timed-out request is not news.
  }
}

export function useChatHealth(): ChatHealth | null {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (timer === null) {
      void poll();
      timer = setInterval(() => void poll(), HEALTH_POLL_MS);
    }
    return () => {
      listeners.delete(setState);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return state;
}

export function ChatHealthNotice({
  rail = false,
}: {
  readonly rail?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const health = useChatHealth();
  if (!health || health.ok) return null;
  const reasons = health.problems.map((p) => {
    switch (p.code) {
      case "BOT_STALE":
        return t(
          "chatHealth.botStale",
          "A customer has waited {{minutes}} min for the bot",
          { minutes: p.minutes ?? 5 },
        );
      case "OUTBOX_STUCK":
        return t(
          "chatHealth.outboxStuck",
          "Replies have not been sent for {{minutes}} min",
          { minutes: p.minutes ?? 5 },
        );
      default:
        return t(
          "chatHealth.waDisconnected",
          "The shop's WhatsApp is disconnected",
        );
    }
  });
  const label = t("chatHealth.label", "Chatbot has a problem");
  return (
    <Tooltip title={reasons.join(" · ")} placement="right">
      <Button
        block={!rail}
        danger
        icon={<WarningFilled />}
        aria-label={`${label}: ${reasons.join(", ")}`}
        data-testid="chat-health-notice"
        onClick={() => navigate("/chat")}
        style={{ fontWeight: WEIGHT.strong }}
      >
        {rail ? null : label}
      </Button>
    </Tooltip>
  );
}
