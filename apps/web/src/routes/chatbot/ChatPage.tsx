/**
 * The chat inbox — three columns side by side, filling the page height
 * (owner redesign 2026-10-15, after calling the old one "very bad, immense
 * cognitive load"): Recent chats, the conversation, and the customer's
 * profile. Fifty customers a day and three staff, so the screen is built so
 * that nobody has to read every message — the profile carries it.
 *
 *  - **Recent chats** (`ThreadList`): name, number, a lead / reservation /
 *    hand-over marker as an icon each, and the unread count. Opening a thread
 *    marks it read (`POST /api/inbox/:phone/read`).
 *  - **The conversation**: bubbles only. The header carries the name, the
 *    number and the per-thread AI switch; an open hand-over or task is ONE
 *    line under it (`ActionItems`). Every bot reply is rated 👍 / 👎
 *    (`ReplyRating`) — that replaced "Fix this". The reply box writes, asks
 *    the bot for a draft, or attaches a unit's QC photos.
 *  - **The profile** (`CustomerProfilePanel`), every field correctable in
 *    place.
 *
 * Below `md` there is room for one column: the list, then a conversation with
 * a back arrow, and the profile behind a button in a drawer.
 *
 * ## Layout
 *
 * Each column is a flex column with `minHeight: 0` all the way up to
 * `PageContainer fill`, because a flex item defaults to `min-height: auto`
 * and refuses to shrink below its content — which is what made an
 * `overflowY: auto` that never scrolled. No fixed pixel heights.
 *
 * ## Where the data comes from
 *
 * `/api/inbox`, backed by `WaMessage`, polled by `useInbox` — a customer
 * writing in is not something staff clicked, so there is no other moment to
 * refetch on. Nothing here is composed in the browser: a summary the worker
 * has not written yet says None rather than being invented.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Input,
  Modal,
  Skeleton,
  Switch,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  IdcardOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import { ApiRequestError } from "../../lib/api.js";
import {
  agentStatus,
  draftReply,
  type AgentStatus,
} from "../../lib/chatApi.js";
import {
  attachMedia,
  markHandled,
  markRead,
  sendReply,
  setAutoReply,
  type ReplyEvaluation,
} from "../../lib/inboxApi.js";
import { handoffTopicLabel } from "../../lib/handoffTopics.js";
import { ActionItems } from "./ActionItems.js";
import { CustomerProfilePanel } from "./CustomerProfilePanel.js";
import { ReplyRating } from "./ReplyRating.js";
import { ThreadList, threadName } from "./ThreadList.js";
import { useInbox } from "../../hooks/useInbox.js";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { asString } from "../../lib/draftGuards.js";
import { useTranslation } from "react-i18next";

/**
 * One line in the conversation. A `WaMessage` row can produce two: what the
 * customer wrote, and the answer stored on the same row.
 */
interface Bubble {
  key: string;
  /** The `WaMessage` id — what an evaluation is filed against. */
  messageId: string;
  side: "in" | "out";
  text: string;
  at: string;
  byAgent: boolean;
  by: string | null;
  evaluation: ReplyEvaluation | null;
}

/** A column: a card whose body scrolls and nothing else does. */
const COLUMN_CARD = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
} as const;

export interface ChatInboxProps {
  /** The thread chosen by hand, or from another tab ("Open chat"). */
  picked: string | null;
  onPick: (phone: string | null) => void;
}

export function ChatInbox({ picked, onPick }: ChatInboxProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const {
    token: {
      colorPrimaryBg,
      colorFillTertiary,
      colorBorderSecondary,
      colorTextSecondary,
      colorWarning,
    },
  } = theme.useToken();
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaSerial, setMediaSerial] = useState("");
  const [attaching, setAttaching] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Asked once, so "Write it for me" can say why it is off before anyone
  // presses it.
  useEffect(() => {
    agentStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  /**
   * On a desktop, land on the thread that is waiting — once, so the auto-pick
   * does not yank the view away from a thread chosen afterwards. A phone opens
   * on the list.
   */
  const [threadsSeen, setThreadsSeen] = useState<string | null>(null);
  const { threads, conversation, loading, error, refresh } = useInbox(
    picked ?? threadsSeen,
  );
  useEffect(() => {
    if (compact || picked || threadsSeen) return;
    const waiting = threads.find((th) => th.needsReply) ?? threads[0];
    if (waiting) setThreadsSeen(waiting.phone);
  }, [compact, picked, threadsSeen, threads]);

  const active = picked ?? threadsSeen;
  const thread = threads.find((th) => th.phone === active) ?? null;
  const activeUnread = thread?.unread ?? 0;

  /*
   * Opening a thread reads it; so does a message arriving while it is open.
   * Keyed on the phone and its unread count, so a poll that changes nothing
   * sends nothing.
   */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    markRead(active)
      .then(() => {
        if (!cancelled && activeUnread > 0) refresh();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, activeUnread > 0]);

  /* The reply being written, one per conversation, kept on this device. */
  const [reply, setReply] = usePersistentState<string>(
    active ? draftKey(`chat.reply.${active}`) : null,
    "",
    asString,
  );
  const showList = !compact || !active;
  const showConversation = !compact || Boolean(active);
  const windowOpen = conversation ? conversation.windowClosesAt !== null : true;

  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    const distanceFromBottom =
      box.scrollHeight - box.scrollTop - box.clientHeight;
    if (box.scrollTop === 0 || distanceFromBottom < 240) {
      box.scrollTop = box.scrollHeight;
    }
  }, [active, conversation?.messages.length]);

  const bubbles = useMemo<Bubble[]>(() => {
    if (!conversation) return [];
    const out: Bubble[] = [];
    for (const m of conversation.messages) {
      out.push({
        key: `${m.id}:in`,
        messageId: m.id,
        side: "in",
        // An image, a sticker, a location: saying what it was beats an empty
        // bubble, which reads as a bug.
        text: m.text ?? `[${m.msgType}]`,
        at: m.at,
        byAgent: false,
        by: null,
        evaluation: null,
      });
      if (m.reply) {
        out.push({
          key: `${m.id}:out`,
          messageId: m.id,
          side: "out",
          text: m.reply.text,
          at: m.reply.at ?? m.at,
          byAgent: m.reply.byAgent,
          by: m.reply.by,
          evaluation: m.reply.evaluation ?? null,
        });
      }
    }
    return out;
  }, [conversation]);

  const errorText = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback;

  const send = async () => {
    const text = reply.trim();
    if (!text || !active) return;
    setSending(true);
    try {
      await sendReply(active, text);
      setReply("");
      // Committed to the outbox; the worker sends. "Queued", not "sent".
      message.success(
        t("chat.queued", "Queued. It goes out in a few seconds."),
      );
      refresh();
    } catch (err) {
      message.error(
        errorText(err, t("chat.sendFailed", "Could not send the reply.")),
      );
    } finally {
      setSending(false);
    }
  };

  /**
   * The per-thread AI switch. Not optimistic: it is a claim about what happens
   * to a customer while nobody is looking, so it waits for the server.
   */
  const toggleAutoReply = async (enabled: boolean) => {
    if (!active) return;
    setSwitching(true);
    try {
      await setAutoReply(active, enabled);
      message.success(
        enabled
          ? t(
              "chat.theBotIsAnsweringThis",
              "The bot is answering this chat again.",
            )
          : t(
              "chat.youReHandlingThisChat",
              "You're handling this chat. The bot won't reply on its own.",
            ),
      );
      refresh();
    } catch (err) {
      message.error(
        errorText(
          err,
          t("chat.couldNotChangeThatSwitch", "Could not change that switch."),
        ),
      );
    } finally {
      setSwitching(false);
    }
  };

  /** The hand-over was dealt with some other way — a call, a visit. */
  const handled = async () => {
    if (!active) return;
    setClosing(true);
    try {
      await markHandled(active);
      message.success(
        t(
          "chat.handledDone",
          "Marked as handled. The bot will answer this customer's next message.",
        ),
      );
      refresh();
    } catch (err) {
      message.error(
        errorText(err, t("chat.handledFailed", "Could not mark it handled.")),
      );
    } finally {
      setClosing(false);
    }
  };

  /** Ask the bot for a draft. It lands in the box; nothing is sent. */
  const draft = async () => {
    if (!conversation) return;
    // A tester's `/new` started the conversation over: draft from after it.
    const resets = new Set(
      conversation.messages.filter((m) => m.reset).map((m) => m.id),
    );
    const since =
      bubbles.reduce((at, b, i) => (resets.has(b.messageId) ? i : at), -1) + 1;
    const turns = bubbles.slice(since).map((b) => ({
      role: b.side === "in" ? ("user" as const) : ("assistant" as const),
      text: b.text,
    }));
    if (turns.length === 0) return;
    setDrafting(true);
    try {
      const result = await draftReply({
        turns,
        ...(active ? { waId: active } : {}),
      });
      setReply(result.reply);
      if (result.handoff) {
        message.info(
          t(
            "chat.draftWouldHandOver",
            "The bot would hand this to a person ({{topic}}). Its holding line is in the box — answer it yourself.",
            { topic: handoffTopicLabel(t, result.handoff.topic) },
          ),
        );
      } else {
        message.success(
          result.sources.some((s) => /^K\d+$/.test(s))
            ? t(
                "chat.draftFromAnswers",
                "Draft ready, from the shop's approved answers.",
              )
            : t("chat.draftReady", "Draft ready."),
        );
      }
    } catch (err) {
      message.error(
        errorText(err, t("chat.draftFailed", "Could not get a draft.")),
      );
    } finally {
      setDrafting(false);
    }
  };

  const attach = async () => {
    const serial = mediaSerial.trim().toUpperCase();
    if (!serial || !active) return;
    setAttaching(true);
    try {
      const { queued } = await attachMedia(active, serial);
      message.success(
        t(
          "chat.mediaQueued",
          "{{n}} photos queued. They go out in a few seconds.",
          {
            n: queued,
          },
        ),
      );
      setMediaOpen(false);
      setMediaSerial("");
      refresh();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        message.error(
          t(
            "chat.mediaWindowClosed",
            "The 24-hour window has closed, so WhatsApp would not deliver the photos.",
          ),
        );
      } else if (err instanceof ApiRequestError && err.status === 404) {
        message.error(
          t(
            "chat.mediaNotFound",
            "No unit with that serial, or it has no QC photos.",
          ),
        );
      } else {
        message.error(
          errorText(err, t("chat.mediaFailed", "Could not attach the photos.")),
        );
      }
    } finally {
      setAttaching(false);
    }
  };

  const name = conversation
    ? ((thread ? threadName(thread) : null) ??
      conversation.profile?.name ??
      conversation.name ??
      conversation.phone)
    : "";

  const listColumn = (
    <Card
      style={
        compact
          ? { ...COLUMN_CARD, flex: 1 }
          : { ...COLUMN_CARD, width: 300, flexShrink: 0 }
      }
      styles={{
        header: { minHeight: 48, paddingInline: 14 },
        body: { padding: 0, flex: 1, minHeight: 0, overflowY: "auto" },
      }}
      title={t("chat.recentChats", "Recent chats")}
      extra={
        // Shown beside the data rather than instead of it: an inbox that
        // empties itself because one poll timed out reads as "all the
        // messages are gone".
        error && !loading ? (
          <Tooltip
            title={t(
              "chat.showingTheLastChatsThat",
              "Showing the last chats that loaded. It will try again in a few seconds.",
            )}
          >
            <WarningOutlined
              aria-label={t(
                "chat.couldnTRefreshJustNow",
                "Couldn't refresh just now",
              )}
              style={{ color: colorWarning }}
            />
          </Tooltip>
        ) : null
      }
    >
      <ThreadList
        threads={threads}
        active={active}
        loading={loading}
        onPick={(phone) => onPick(phone)}
      />
    </Card>
  );

  const profilePanel =
    conversation && active ? (
      <CustomerProfilePanel
        phone={active}
        conversation={conversation}
        onChanged={refresh}
      />
    ) : null;

  const conversationColumn =
    !active || !conversation ? (
      <Card style={{ flex: 1 }}>
        {loading || active ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <Empty
            description={t("chat.pickAChatOnThe", "Pick a chat on the left.")}
          />
        )}
      </Card>
    ) : (
      <Card
        style={{ ...COLUMN_CARD, flex: 1, minWidth: 0 }}
        styles={{
          header: { minHeight: 48, paddingInline: 14 },
          body: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            gap: 10,
            padding: 14,
          },
        }}
        title={
          <Flex align="center" gap={8} style={{ minWidth: 0 }}>
            {compact && (
              <Button
                type="text"
                size="small"
                icon={<ArrowLeftOutlined />}
                aria-label={t("chat.backToChats", "Back to chats")}
                onClick={() => onPick(null)}
              />
            )}
            <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
              {name}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ fontWeight: 400, flexShrink: 0 }}
            >
              {conversation.phone}
            </Typography.Text>
          </Flex>
        }
        extra={
          <Flex align="center" gap={8}>
            <Tooltip
              title={
                conversation.autoReply.enabled
                  ? t(
                      "chat.turnThisOffToAnswer",
                      "Turn this off to answer this customer yourself. Other chats are unaffected.",
                    )
                  : t(
                      "chat.turnThisOnToLetThe",
                      "Turn this on to let the bot answer this customer again.",
                    )
              }
            >
              <Flex align="center" gap={6}>
                <RobotOutlined />
                <Typography.Text
                  type={conversation.autoReply.enabled ? undefined : "warning"}
                >
                  {conversation.autoReply.enabled
                    ? t("chat.aiOn", "AI on")
                    : t("chat.aiOff", "AI off")}
                </Typography.Text>
                <Switch
                  size="small"
                  checked={conversation.autoReply.enabled}
                  loading={switching}
                  onChange={(v) => void toggleAutoReply(v)}
                  aria-label={t(
                    "chat.letTheBotAnswerThis",
                    "Let the bot answer this chat on its own",
                  )}
                />
              </Flex>
            </Tooltip>
            {compact && (
              <Button
                size="small"
                icon={<IdcardOutlined />}
                aria-label={t("chat.showProfile", "Customer profile")}
                onClick={() => setProfileOpen(true)}
              />
            )}
          </Flex>
        }
      >
        <ActionItems
          phone={conversation.phone}
          actions={conversation.actions ?? []}
          profile={conversation.profile ?? null}
          onChanged={refresh}
          handoff={conversation.handoff}
          onMarkHandled={() => void handled()}
          marking={closing}
        />

        <Flex
          ref={messagesRef}
          vertical
          gap={10}
          role="log"
          aria-label={t("chat.messages", "Messages")}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingInline: 2 }}
        >
          {bubbles.map((b) => {
            const mine = b.side === "out";
            return (
              <Flex key={b.key} justify={mine ? "flex-end" : "flex-start"}>
                <div
                  data-testid={mine && b.byAgent ? "bot-bubble" : undefined}
                  style={{
                    maxWidth: compact ? "88%" : "72%",
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: mine ? colorPrimaryBg : colorFillTertiary,
                    border: `1px solid ${colorBorderSecondary}`,
                  }}
                >
                  {mine && (
                    <Typography.Text
                      style={{ fontSize: 12, color: colorTextSecondary }}
                    >
                      {b.byAgent ? (
                        <>
                          <RobotOutlined /> {t("chat.bot", "Bot")}
                        </>
                      ) : (
                        (b.by ?? t("chat.staff", "Staff"))
                      )}
                    </Typography.Text>
                  )}
                  <div style={{ whiteSpace: "pre-wrap" }}>{b.text}</div>
                  <Flex justify="space-between" align="center" gap={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtDateTime(b.at)}
                    </Typography.Text>
                    {mine && b.byAgent && (
                      <ReplyRating
                        messageId={b.messageId}
                        text={b.text}
                        evaluation={b.evaluation}
                        onChanged={refresh}
                      />
                    )}
                  </Flex>
                </div>
              </Flex>
            );
          })}
        </Flex>

        {/* 06 §11: outside the 24-hour window a free-form reply cannot be
            delivered, and a box that looks functional but cannot deliver is
            worse than a disabled one. One line, not a paragraph. */}
        {!windowOpen && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "chat.windowClosedLine",
              "The 24-hour window has closed — a free reply would not arrive.",
            )}
          />
        )}

        <Flex gap={8} vertical={compact}>
          <Input.TextArea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={!windowOpen}
            aria-label={t("chat.reply", "Reply")}
            placeholder={t(
              "chat.typeYourReplyOrPress",
              "Type your reply, or press Write it for me and edit what comes back.",
            )}
          />
          <Flex gap={6} vertical={!compact}>
            <Tooltip
              title={
                status?.enabled
                  ? t(
                      "chat.draftHint",
                      "The bot reads this chat and writes a reply for you. Nothing is sent until you press Send.",
                    )
                  : t(
                      "chat.draftNeedsLogin",
                      "Needs a Claude login on the server",
                    )
              }
            >
              <Button
                icon={<ThunderboltOutlined />}
                loading={drafting}
                disabled={!status?.enabled || !windowOpen}
                onClick={() => void draft()}
              >
                {t("chat.writeItForMe", "Write it for me")}
              </Button>
            </Tooltip>
            <Flex gap={6}>
              <Tooltip title={t("chat.attachMedia", "Attach a unit's photos")}>
                <Button
                  icon={<PaperClipOutlined />}
                  aria-label={t("chat.attachMedia", "Attach a unit's photos")}
                  disabled={!windowOpen}
                  onClick={() => setMediaOpen(true)}
                />
              </Tooltip>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={sending}
                disabled={!reply.trim() || !windowOpen}
                onClick={() => void send()}
                style={{ flex: 1 }}
              >
                {t("chat.send", "Send")}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Card>
    );

  return (
    <>
      <Flex gap={12} style={{ flex: 1, minHeight: 0 }}>
        {showList && listColumn}
        {showConversation && conversationColumn}
        {!compact && profilePanel && (
          <Card
            style={{ ...COLUMN_CARD, width: 320, flexShrink: 0 }}
            styles={{
              header: { minHeight: 48, paddingInline: 14 },
              body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 14 },
            }}
            title={t("chat.customerProfile", "Customer profile")}
          >
            {profilePanel}
          </Card>
        )}
      </Flex>

      {compact && (
        <Drawer
          title={t("chat.customerProfile", "Customer profile")}
          open={profileOpen && profilePanel !== null}
          onClose={() => setProfileOpen(false)}
          size="large"
        >
          {profilePanel}
        </Drawer>
      )}

      <Modal
        title={t("chat.attachMediaTitle", "Send a unit's QC photos")}
        open={mediaOpen}
        okText={t("chat.attachSend", "Send photos")}
        okButtonProps={{ loading: attaching, disabled: !mediaSerial.trim() }}
        onOk={() => void attach()}
        onCancel={() => setMediaOpen(false)}
        destroyOnHidden
      >
        <Flex vertical gap={8}>
          <Typography.Text type="secondary">
            {t(
              "chat.attachMediaHint",
              "Up to three of the unit's QC photos go to this customer.",
            )}
          </Typography.Text>
          <Input
            autoFocus
            aria-label={t("chat.unitSerial", "Unit serial")}
            placeholder={t("chat.unitSerial", "Unit serial")}
            value={mediaSerial}
            onChange={(e) => setMediaSerial(e.target.value.toUpperCase())}
            onPressEnter={() => void attach()}
          />
        </Flex>
      </Modal>
    </>
  );
}
