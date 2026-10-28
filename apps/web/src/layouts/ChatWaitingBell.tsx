/**
 * "🔔 3 chats need a reply" on every page (owner, 2026-10-28) — in the
 * sidebar's foot on a desktop, in the top bar on a phone. Nothing at zero.
 * A press opens the chat that has waited longest.
 */
import { Badge, Button, Tooltip } from "antd";
import { BellFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useChatWaiting } from "../hooks/useChatWaiting.js";
import { WEIGHT } from "../theme/tokens";

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
  const { count, oldest } = useChatWaiting();
  if (count === 0) return null;
  const label = t("chatWaiting.label", "{{count}} chat(s) need a reply", {
    count,
  });
  const open = () => {
    navigate(oldest ? `/chat?phone=${encodeURIComponent(oldest)}` : "/chat");
    onOpen?.();
  };
  return (
    <Tooltip title={rail ? label : ""} placement="right">
      <Badge count={rail ? count : 0} size="small" offset={[-4, 4]}>
        <Button
          block={!rail}
          danger
          type="primary"
          icon={<BellFilled />}
          aria-label={label}
          data-testid="chat-waiting-bell"
          onClick={open}
          style={{ fontWeight: WEIGHT.strong }}
        >
          {rail ? null : label}
        </Button>
      </Badge>
    </Tooltip>
  );
}
