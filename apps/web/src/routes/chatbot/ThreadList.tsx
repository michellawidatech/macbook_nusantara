/**
 * Recent chats — the left column of /chat (owner ask 2026-10-15).
 *
 * Two lines per thread and nothing that wraps: the name, cut with an ellipsis
 * to the column (the old list squashed a long name into four lines), and the
 * number under it with the thread's markers as ICONS — a red fire for a lead,
 * a blue calendar for an open reservation, an orange person for a hand-over —
 * and the unread count on the right. Ten to twenty-five customers at once is
 * a list somebody scans, not one they read.
 *
 * A chat waiting for a person carries what it waits FOR as a coloured tag,
 * and a row of chips above the list filters by it, "All" first (owner,
 * 2026-11-16: *"categorize chats waiting for a person so staff know which
 * to answer"*) — lib/chatCategory.ts is the reading.
 *
 * An Instagram thread (2026-11-16) is called by its @username and its second
 * line says Instagram: its key (`ig:<IGSID>`) is an address, not a number
 * anybody could ring, and is never shown as one.
 */
import { useState } from "react";
import {
  Badge,
  Empty,
  Flex,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CalendarFilled,
  FireFilled,
  InstagramOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { realName } from "@nusantara/domain";
import { fmtDateTime } from "../../lib/format.js";
import {
  isInstagramKey,
  type InboxChannel,
  type InboxThread,
} from "../../lib/inboxApi.js";
import {
  CATEGORY_ORDER,
  categoryColor,
  categoryCounts,
  categoryLabel,
  threadCategories,
  type ChatCategory,
} from "../../lib/chatCategory.js";
import { CategoryTag } from "./CategoryTag.js";

/**
 * What the list calls a thread: the best name the server has, else the number.
 * An Instagram thread is its `@username`, else a name, else `igFallback`
 * ("Instagram user") — never its `ig:` key.
 */
export function threadName(
  t: Pick<InboxThread, "displayName" | "name" | "phone"> & {
    username?: string | null;
  },
  igFallback = "Instagram",
) {
  if (isInstagramKey(t.phone)) {
    const handle = t.username?.trim().replace(/^@/, "");
    if (handle) return `@${handle}`;
    return realName(t.displayName) ?? realName(t.name) ?? igFallback;
  }
  // Never a placeholder like "unknown" (2026-10-27): the number instead.
  return realName(t.displayName) ?? realName(t.name) ?? t.phone;
}

/**
 * The line under an Instagram thread's name: the person's name when the
 * @username is the headline, else just the channel.
 */
function instagramSubline(
  c: Pick<InboxThread, "displayName" | "name"> & { username?: string | null },
): string | null {
  if (!c.username?.trim()) return null;
  return realName(c.displayName) ?? realName(c.name);
}

export interface ThreadListProps {
  threads: InboxThread[];
  active: string | null;
  loading: boolean;
  onPick: (phone: string) => void;
  /** Which inbox this is — only the empty-list sentence differs. */
  channel?: InboxChannel;
}

export function ThreadList({
  threads,
  active,
  loading,
  onPick,
  channel = "whatsapp",
}: ThreadListProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ChatCategory | null>(null);
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
        description={
          channel === "instagram"
            ? t(
                "chat.ig.noChatsYet",
                "No Instagram chats yet. Any DM a customer sends the shop's Instagram shows up here.",
              )
            : t(
                "chat.noChatsYetAnythingA",
                "No chats yet. Anything a customer sends on WhatsApp shows up here.",
              )
        }
      />
    );

  const counts = categoryCounts(threads);
  // A chosen category stays offered while it is chosen, even emptied by a
  // refresh, or there would be no chip to press to undo it.
  const chips = CATEGORY_ORDER.filter(
    (c) => (counts.get(c) ?? 0) > 0 || c === filter,
  );
  const shown = filter
    ? threads.filter((c) => threadCategories(c).includes(filter))
    : threads;

  return (
    <nav aria-label={t("chat.recentChats", "Recent chats")}>
      {chips.length > 0 && (
        <Flex
          wrap
          gap={6}
          role="group"
          aria-label={t("chat.category.filter", "Filter chats by category")}
          style={{
            padding: "8px 14px",
            borderBottom: `1px solid ${colorBorderSecondary}`,
          }}
        >
          <Tag.CheckableTag
            checked={filter === null}
            onChange={() => setFilter(null)}
            data-filter="all"
          >
            {t("chat.category.all", "All")} ({threads.length})
          </Tag.CheckableTag>
          {chips.map((c) => (
            <Tag.CheckableTag
              key={c}
              checked={filter === c}
              onChange={() => setFilter(filter === c ? null : c)}
              data-filter={c}
            >
              <Badge color={categoryColor(c) ?? "default"} />{" "}
              {categoryLabel(t, c)} ({counts.get(c) ?? 0})
            </Tag.CheckableTag>
          ))}
        </Flex>
      )}
      {shown.length === 0 && (
        <Empty
          style={{ padding: 24 }}
          description={t(
            "chat.category.noneInFilter",
            "No chats in this category.",
          )}
        />
      )}
      {shown.map((c) => {
        const name = threadName(c, t("chat.ig.unnamed", "Instagram user"));
        const instagram = isInstagramKey(c.phone);
        const categories = threadCategories(c);
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
                {instagram ? (
                  <>
                    <InstagramOutlined />{" "}
                    {instagramSubline(c) ?? t("chat.ig.channel", "Instagram")}
                  </>
                ) : (
                  c.phone
                )}
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
            {categories.length > 0 && (
              <Flex wrap gap={4} style={{ marginTop: 4 }}>
                {categories.map((cat) => (
                  <CategoryTag key={cat} category={cat} />
                ))}
              </Flex>
            )}
          </button>
        );
      })}
    </nav>
  );
}
