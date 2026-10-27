/**
 * Recent chats — the left column of /chat (owner ask 2026-10-15).
 *
 * Two lines per thread and nothing that wraps: the name, cut with an ellipsis
 * to the column (the old list squashed a long name into four lines), and the
 * number under it with the thread's markers as ICONS — a red fire for a lead,
 * a blue calendar for an open reservation, an orange person for a hand-over —
 * and the unread count on the right. Ten to twenty-five customers at once is
 * a list somebody scans, not one they read.
 */
import { Badge, Empty, Flex, Skeleton, Tooltip, Typography, theme } from "antd";
import { CalendarFilled, FireFilled, UserOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { realName } from "@nusantara/domain";
import { fmtDateTime } from "../../lib/format.js";
import type { InboxThread } from "../../lib/inboxApi.js";

/** What the list calls a thread: the best name the server has, else the number. */
export function threadName(
  t: Pick<InboxThread, "displayName" | "name" | "phone">,
) {
  // Never a placeholder like "unknown" (2026-10-27): the number instead.
  return realName(t.displayName) ?? realName(t.name) ?? t.phone;
}

export interface ThreadListProps {
  threads: InboxThread[];
  active: string | null;
  loading: boolean;
  onPick: (phone: string) => void;
}

export function ThreadList({
  threads,
  active,
  loading,
  onPick,
}: ThreadListProps) {
  const { t } = useTranslation();
  const {
    token: {
      colorPrimaryBg,
      colorBorderSecondary,
      colorError,
      colorInfo,
      colorWarning,
    },
  } = theme.useToken();

  if (loading)
    return (
      <div style={{ padding: 16 }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  if (threads.length === 0)
    return (
      <Empty
        style={{ padding: 24 }}
        description={t(
          "chat.noChatsYetAnythingA",
          "No chats yet. Anything a customer sends on WhatsApp shows up here.",
        )}
      />
    );

  return (
    <nav aria-label={t("chat.recentChats", "Recent chats")}>
      {threads.map((c) => {
        const name = threadName(c);
        const tags = c.tags ?? {
          lead: false,
          reservation: false,
          escalation: false,
        };
        const unread = c.unread ?? 0;
        return (
          <button
            key={c.phone}
            type="button"
            className="chat-thread-row"
            aria-current={c.phone === active ? "true" : undefined}
            aria-label={name}
            data-phone={c.phone}
            onClick={() => onPick(c.phone)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "start",
              border: 0,
              borderBottom: `1px solid ${colorBorderSecondary}`,
              padding: "10px 14px",
              cursor: "pointer",
              font: "inherit",
              color: "inherit",
              background: c.phone === active ? colorPrimaryBg : "transparent",
            }}
          >
            <Flex align="center" gap={8} style={{ minWidth: 0 }}>
              <Typography.Text
                strong={unread > 0}
                ellipsis
                style={{ flex: 1, minWidth: 0 }}
              >
                {name}
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, flexShrink: 0 }}
              >
                {fmtDateTime(c.lastAt)}
              </Typography.Text>
            </Flex>
            <Flex align="center" gap={8} style={{ minWidth: 0 }}>
              <Typography.Text
                type="secondary"
                ellipsis
                style={{ fontSize: 12, minWidth: 0 }}
              >
                {c.phone}
              </Typography.Text>
              <Flex gap={6} align="center" style={{ flexShrink: 0 }}>
                {tags.lead && (
                  <Tooltip title={t("chat.tagLead", "Lead")}>
                    <FireFilled
                      aria-label={t("chat.tagLead", "Lead")}
                      style={{ color: colorError }}
                    />
                  </Tooltip>
                )}
                {tags.reservation && (
                  <Tooltip
                    title={t("chat.tagReservation", "Has a reservation")}
                  >
                    <CalendarFilled
                      aria-label={t("chat.tagReservation", "Has a reservation")}
                      style={{ color: colorInfo }}
                    />
                  </Tooltip>
                )}
                {tags.escalation && (
                  <Tooltip title={t("chat.tagEscalation", "Needs a person")}>
                    <UserOutlined
                      aria-label={t("chat.tagEscalation", "Needs a person")}
                      style={{ color: colorWarning }}
                    />
                  </Tooltip>
                )}
              </Flex>
              {unread > 0 && (
                <span
                  aria-label={t("chat.unreadN", "{{n}} unread", { n: unread })}
                  style={{ marginInlineStart: "auto", flexShrink: 0 }}
                >
                  <Badge count={unread} />
                </span>
              )}
            </Flex>
          </button>
        );
      })}
    </nav>
  );
}
