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
 *    number, the per-thread AI switch and — while something waits on a
 *    person — Mark handled. A message the bot handed over is OUTLINED in the
 *    conversation, with one caption saying why; there is no pop-up and no
 *    task strip (owner, 2026-10-15: "just highlight the unanswered chat (add
 *    a shadow / outline, not a popup modal)"). Every bot reply is rated 👍 / 👎
 *    (`ReplyRating`) — that replaced "Fix this". The reply box writes, asks
 *    the bot for a draft, or — behind the 📎 — attaches a unit's QC photos or
 *    a picture from this device (`SendPictureModal`, 2026-10-27).
 *  - **What was sent** (2026-10-23, `SentItems`): a photo the shop sent is
 *    drawn at its time, and every sent bubble carries a ⋯ to edit (a text,
 *    15 minutes) or unsend it. A reply bubble finds its outbox row by
 *    `reply.outboxId`, which the server matched; every sent item no reply
 *    claimed — a photo, the line before it, a reply a later one overwrote —
 *    is its own bubble, slotted in by time.
 *  - **The profile** (`CustomerProfilePanel`), every field correctable in
 *    place.
 *  - **Clear chat / Delete conversation** (2026-10-27), behind the header's
 *    ⋯. Clearing hides the chat and makes the bot forget it (nothing is
 *    deleted; the customer writing again brings it back with only the new
 *    messages). Deleting is the owner's, permanent, and asks for the number
 *    typed back; the profile, ratings and corrections stay. Either way the
 *    thread leaves the list and the selection moves off it.
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
  Dropdown,
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
  EllipsisOutlined,
  IdcardOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime, fmtTime } from "../../lib/format.js";
import { ApiRequestError } from "../../lib/api.js";
import {
  agentStatus,
  draftReply,
  type AgentStatus,
} from "../../lib/chatApi.js";
import {
  attachMedia,
  clearConversation,
  deleteConversation,
  markHandled,
  markRead,
  sendReply,
  setAutoReply,
  type ReplyEvaluation,
  type SentItem,
} from "../../lib/inboxApi.js";
import { waitReason, type WaitReason } from "../../lib/botWait.js";
import { SentMenu, SentPhoto } from "./SentItems.js";
import { handoffTopicLabel } from "../../lib/handoffTopics.js";
import type { TFunction } from "../../i18n/translate.js";
import { CustomerProfilePanel } from "./CustomerProfilePanel.js";
import { ReplyRating } from "./ReplyRating.js";
import { ThreadList, threadName } from "./ThreadList.js";
import { UnitPhotoPicker } from "./UnitPhotoPicker.js";
import { SendPictureModal } from "./SendPictureModal.js";
import { useInbox } from "../../hooks/useInbox.js";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { asString } from "../../lib/draftGuards.js";
import { useTranslation } from "react-i18next";
import { realName } from "@nusantara/domain";
import { useDb } from "../../mock/store.js";
import { pendingRequestFor } from "../../lib/reservationRequests.js";
import {
  ApproveRequestModal,
  RejectRequestModal,
  RequestStrip,
} from "../../components/ReservationRequestDialogs";

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
  /**
   * A customer message still waiting on a PERSON: handed over by the bot
   * (PERLU_STAF), or arrived while the bot is off for this chat (BARU). Not a
   * BARU row with the bot on — the bot answers that in seconds, and outlining
   * it would flicker.
   */
  waiting: boolean;
  /** Why the bot handed it over, for the caption under the outline. */
  waitingTopic: string | null;
  /**
   * Why it is waiting on a person (2026-10-27): handed over, the bot could
   * not reply, the bot is off, a colleague is mid-chat, or the bot is late.
   */
  waitingWhy: WaitReason | null;
  /** The outbox row this bubble is, when it was sent through one. */
  sent: SentItem | null;
}

/**
 * The caption under a waiting customer message: why it waits (2026-10-27).
 * Literal `t()` calls, so test/i18n.test.ts can find every one.
 */
function waitCaption(
  t: TFunction,
  b: Pick<Bubble, "waitingWhy" | "waitingTopic">,
): string {
  const why = b.waitingWhy;
  switch (why?.kind) {
    case "bot_failed":
      return t("chat.wait.botFailed", "Bot couldn't reply — handed to you");
    case "bot_off":
      return t(
        "chat.wait.botOff",
        "Needs your reply · AI switched off for this chat",
      );
    case "staff_active":
      return why.by
        ? t(
            "chat.wait.staffActive",
            "Bot paused — {{name}} replied {{minutes}} min ago",
            { name: why.by, minutes: why.minutes },
          )
        : t(
            "chat.wait.staffActiveNoName",
            "Bot paused — staff replied {{minutes}} min ago",
            { minutes: why.minutes },
          );
    case "bot_late":
      return t(
        "chat.wait.botLate",
        "Bot hasn't replied for {{minutes}} min — reply yourself or check the worker",
        { minutes: why.minutes },
      );
    default:
      return b.waitingTopic
        ? t("chat.needsReplyTopic", "Needs your reply · {{topic}}", {
            topic: handoffTopicLabel(t, b.waitingTopic),
          })
        : t("chat.needsReply", "Needs your reply");
  }
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
  /** Offers Delete conversation, which the server allows the owner only. */
  isOwner?: boolean;
}

/** The number as typed back to confirm a delete: its digits. */
const digitsOf = (v: string) => v.replace(/\D/g, "");

export function ChatInbox({ picked, onPick, isOwner = false }: ChatInboxProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
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
  const [pictureOpen, setPictureOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  /** Delete conversation's dialog, and the number typed into it. */
  const [deleting, setDeleting] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  /**
   * Threads just cleared or deleted, kept off the list until the server's
   * list has caught up — otherwise the poll in flight would draw it back for
   * a moment, and the desktop auto-pick could land on it again.
   */
  const [gone, setGone] = useState<string[]>([]);
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
  const {
    threads: listed,
    conversation,
    loading,
    error,
    refresh,
  } = useInbox(picked ?? threadsSeen);
  const threads = useMemo(
    () => listed.filter((th) => !gone.includes(th.phone)),
    [listed, gone],
  );
  // Once the server no longer lists a thread it is truly gone from the list;
  // forget it here, so the customer writing again brings it back.
  useEffect(() => {
    if (gone.length === 0) return;
    const still = gone.filter((p) => listed.some((th) => th.phone === p));
    if (still.length !== gone.length) setGone(still);
  }, [listed, gone]);
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
  /** Something waits on a person: a hand-over, or a task the bot left. */
  const waitingOnPerson = Boolean(
    conversation &&
    (conversation.handoff !== null ||
      (conversation.actions ?? []).some((a) => a.status === "OPEN")),
  );

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
    const nowMs = Date.now();
    const sent = conversation.sent ?? [];
    const sentById = new Map(sent.map((x) => [x.id, x]));
    const claimed = new Set<string>();
    for (const m of conversation.messages) {
      // Status, not `m.handoff`: the server keeps the hand-over note on a row
      // staff have since answered (DIJAWAB_STAF), which is no longer waiting.
      // A BARU row with the bot on is outlined only once it is the bot's no
      // longer — a colleague is mid-chat, or the bot is late (lib/botWait).
      const why = waitReason(m, conversation, nowMs);
      const waiting = why !== null;
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
        waiting,
        waitingTopic: why?.kind === "handed_over" ? why.topic : null,
        waitingWhy: why,
        sent: null,
      });
      if (m.reply) {
        const own = m.reply.outboxId ? sentById.get(m.reply.outboxId) : null;
        if (own) claimed.add(own.id);
        out.push({
          key: `${m.id}:out`,
          messageId: m.id,
          side: "out",
          text: m.reply.text,
          at: m.reply.at ?? m.at,
          byAgent: m.reply.byAgent,
          by: m.reply.by,
          evaluation: m.reply.evaluation ?? null,
          waiting: false,
          waitingTopic: null,
          waitingWhy: null,
          sent: own ?? null,
        });
      }
    }
    /*
     * Every sent item no reply claimed, slotted in by time without
     * disturbing the order above (an answer stays under its question). One
     * older than the first message shown belongs to history the 200-row cap
     * already dropped.
     */
    const first = conversation.messages[0]?.at ?? "";
    const extras = sent
      .filter((x) => !claimed.has(x.id))
      .map<Bubble>((x) => ({
        key: `${x.id}:sent`,
        messageId: x.inReplyTo ?? x.id,
        side: "out",
        text: x.body ?? "",
        at: x.sentAt ?? x.createdAt,
        // A line the worker sent that a later reply took off its message's
        // row is still the bot's (2026-10-28).
        byAgent: x.fromBot === true,
        by: null,
        evaluation: null,
        waiting: false,
        waitingTopic: null,
        waitingWhy: null,
        sent: x,
      }))
      .filter((b) => b.at >= first);
    if (extras.length === 0) return out;
    const merged: Bubble[] = [];
    let i = 0;
    for (const b of out) {
      while (i < extras.length && extras[i]!.at < b.at)
        merged.push(extras[i++]!);
      merged.push(b);
    }
    return [...merged, ...extras.slice(i)];
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

  /**
   * After a clear or a delete: the thread leaves the list and the selection
   * moves off it — to the next waiting thread on a desktop, to the list on a
   * phone.
   */
  const leave = (phone: string) => {
    setGone((g) => (g.includes(phone) ? g : [...g, phone]));
    const rest = threads.filter((th) => th.phone !== phone);
    const next = compact
      ? null
      : (rest.find((th) => th.needsReply) ?? rest[0] ?? null);
    onPick(null);
    setThreadsSeen(next?.phone ?? null);
    refresh();
  };

  /** Clear chat: hidden, and the bot forgets it. Anybody signed in. */
  const clear = () => {
    if (!active) return;
    const phone = active;
    modal.confirm({
      title: t("chat.clearTitle", "Clear this chat?"),
      content: t(
        "chat.clearBody",
        "The chat leaves the list and the bot starts over: it forgets the conversation, the lead and what it learned about the customer (name, use, budget, preferences). Nothing is deleted: the knowledge base, the customer record and notes a colleague added stay. If the customer writes again, the chat comes back with only the new messages.",
      ),
      okText: t("chat.clearOk", "Clear chat"),
      cancelText: t("common.cancel", "Cancel"),
      onOk: async () => {
        try {
          await clearConversation(phone);
          message.success(t("chat.cleared", "Chat cleared."));
          leave(phone);
        } catch (err) {
          message.error(
            errorText(err, t("chat.clearFailed", "Could not clear the chat.")),
          );
        }
      },
    });
  };

  /** Delete conversation, for good — the owner's, after the number typed back. */
  const remove = async () => {
    if (!active || digitsOf(deleteTyped) !== active || deleteBusy) return;
    const phone = active;
    setDeleteBusy(true);
    try {
      await deleteConversation(phone, deleteTyped.trim());
      setDeleting(false);
      message.success(t("chat.deleted", "Conversation deleted."));
      leave(phone);
    } catch (err) {
      message.error(
        errorText(
          err,
          t("chat.deleteFailed", "Could not delete the conversation."),
        ),
      );
    } finally {
      setDeleteBusy(false);
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
    const turns = bubbles
      .slice(since)
      // A photo has no words, and an unsent line is not what the customer has.
      .filter((b) => b.text && !b.sent?.retractedAt)
      .map((b) => ({
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

  const attach = async (serials: string[]) => {
    if (serials.length === 0 || !active) return;
    setAttaching(true);
    try {
      const { queued, units, skipped } = await attachMedia(active, serials);
      message.success(
        t(
          "chat.mediaQueuedUnits",
          "Photos of {{units}} unit(s) queued ({{n}} photos). They go out in a few seconds.",
          { units, n: queued },
        ),
      );
      if (skipped.length > 0)
        message.warning(
          t(
            "chat.mediaSkipped",
            "Not sent, no photos or no longer on sale: {{serials}}",
            { serials: skipped.join(", ") },
          ),
        );
      setMediaOpen(false);
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
      realName(conversation.profile?.name) ??
      realName(conversation.name) ??
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
            {waitingOnPerson && (
              <Button
                size="small"
                loading={closing}
                onClick={() => void handled()}
              >
                {t("chat.markHandled", "Mark handled")}
              </Button>
            )}
            {compact && (
              <Button
                size="small"
                icon={<IdcardOutlined />}
                aria-label={t("chat.showProfile", "Customer profile")}
                onClick={() => setProfileOpen(true)}
              />
            )}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "clear", label: t("chat.clearChat", "Clear chat") },
                  ...(isOwner
                    ? [
                        {
                          key: "delete",
                          danger: true,
                          label: t(
                            "chat.deleteConversation",
                            "Delete conversation",
                          ),
                        },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  if (key === "clear") clear();
                  else {
                    setDeleteTyped("");
                    setDeleting(true);
                  }
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<EllipsisOutlined />}
                aria-label={t("chat.chatActions", "Chat actions")}
              />
            </Dropdown>
          </Flex>
        }
      >
        {/* The bot's reservation request waiting on this chat (2026-10-27):
            the same Approve / Reject the Requests tab has. */}
        <ChatRequestStrip phone={conversation.phone} />
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
                  data-waiting={b.waiting ? "true" : undefined}
                  style={{
                    maxWidth: compact ? "88%" : "72%",
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: mine ? colorPrimaryBg : colorFillTertiary,
                    border: `1px solid ${colorBorderSecondary}`,
                    // Outline and shadow move nothing: a waiting bubble stands
                    // out without the conversation reflowing around it.
                    ...(b.waiting
                      ? {
                          outline: `2px solid ${colorWarning}`,
                          outlineOffset: 1,
                          boxShadow: `0 0 0 5px color-mix(in srgb, ${colorWarning} 22%, transparent)`,
                        }
                      : {}),
                  }}
                >
                  {mine && (
                    <Flex justify="space-between" align="center" gap={8}>
                      <Typography.Text
                        style={{ fontSize: 12, color: colorTextSecondary }}
                      >
                        {b.byAgent ? (
                          <>
                            <RobotOutlined /> {t("chat.bot", "Bot")}
                          </>
                        ) : b.key.endsWith(":sent") ? (
                          b.sent?.sentBy ? (
                            t("chat.sentByName", "Sent by {{name}}", {
                              name: b.sent.sentBy,
                            })
                          ) : (
                            t("chat.sentByShop", "Sent")
                          )
                        ) : (
                          (b.by ?? t("chat.staff", "Staff"))
                        )}
                      </Typography.Text>
                      {b.sent && active && (
                        <SentMenu
                          phone={active}
                          item={b.sent}
                          onChanged={refresh}
                        />
                      )}
                    </Flex>
                  )}
                  {b.sent?.retractedAt ? (
                    <Typography.Text
                      type="secondary"
                      italic
                      data-testid="sent-unsent"
                    >
                      {b.sent.retractedBy
                        ? t("chat.unsentBy", "Unsent by {{name}} · {{time}}", {
                            name: b.sent.retractedBy,
                            time: fmtDateTime(b.sent.retractedAt),
                          })
                        : t("chat.unsentLabel", "Unsent")}
                    </Typography.Text>
                  ) : b.sent?.kind === "WA_IMAGE" && active ? (
                    <>
                      <SentPhoto phone={active} item={b.sent} />
                      {b.sent.caption && (
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {b.sent.caption}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap" }}>{b.text}</div>
                  )}
                  {b.waiting && (
                    <Typography.Text
                      style={{
                        fontSize: 12,
                        color: colorWarning,
                        display: "block",
                      }}
                    >
                      {waitCaption(t, b)}
                    </Typography.Text>
                  )}
                  <Flex justify="space-between" align="center" gap={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtDateTime(b.at)}
                      {b.sent?.editedAt && !b.sent.retractedAt
                        ? ` · ${
                            b.sent.editedBy
                              ? t(
                                  "chat.editedBy",
                                  "Edited by {{name}} · {{time}}",
                                  {
                                    name: b.sent.editedBy,
                                    time: fmtTime(b.sent.editedAt),
                                  },
                                )
                              : t("chat.editedLabel", "Edited")
                          }`
                        : ""}
                      {b.sent && b.sent.status === "FAILED"
                        ? ` · ${t("chat.notDelivered", "Not delivered")}`
                        : b.sent && b.sent.status !== "SENT"
                          ? ` · ${t("chat.queuedLabel", "Queued")}`
                          : ""}
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
              {/* One 📎, two sources: a unit's QC photos from the POS, or a
                  picture from this computer or phone (2026-10-27). */}
              <Dropdown
                trigger={["click"]}
                disabled={!windowOpen}
                menu={{
                  items: [
                    {
                      key: "unit",
                      label: t("chat.attachMedia", "Attach a unit's photos"),
                    },
                    {
                      key: "device",
                      label: t(
                        "chat.attachPicture",
                        "Send a picture from this device",
                      ),
                    },
                  ],
                  onClick: ({ key }) =>
                    key === "unit" ? setMediaOpen(true) : setPictureOpen(true),
                }}
              >
                <Button
                  icon={<PaperClipOutlined />}
                  aria-label={t("chat.attach", "Attach")}
                  disabled={!windowOpen}
                />
              </Dropdown>
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

      {/* Two layers: this dialog, then the number typed back — the
          activity log's clear, for the one chat action nothing undoes. */}
      <Modal
        open={deleting}
        title={t("chat.deleteTitle", "Delete this conversation for good?")}
        okText={t("chat.deleteOk", "Delete conversation")}
        okButtonProps={{
          danger: true,
          disabled: !active || digitsOf(deleteTyped) !== active,
        }}
        cancelText={t("common.cancel", "Cancel")}
        confirmLoading={deleteBusy}
        onCancel={() => setDeleting(false)}
        onOk={() => void remove()}
        destroyOnHidden
      >
        <Flex vertical gap={10}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t(
              "chat.deleteBody",
              "Every message, what was sent and the bot's memory of this chat, including what it learned about the customer, are removed and cannot be recovered. The customer record, the 👍/👎 ratings and the knowledge-base corrections stay.",
            )}
          </Typography.Paragraph>
          <Typography.Text>
            {t("chat.deleteTypeIt", "Type the number")}{" "}
            <Typography.Text code>{active ?? ""}</Typography.Text>{" "}
            {t("chat.deleteToConfirm", "to confirm.")}
          </Typography.Text>
          <Input
            value={deleteTyped}
            onChange={(e) => setDeleteTyped(e.target.value)}
            onPressEnter={() => void remove()}
            inputMode="numeric"
            aria-label={t(
              "chat.deleteTypeAria",
              "Type the customer's number to confirm",
            )}
            placeholder={active ?? ""}
          />
        </Flex>
      </Modal>

      <SendPictureModal
        phone={active}
        open={pictureOpen}
        onClose={() => setPictureOpen(false)}
        onSent={() => {
          setPictureOpen(false);
          refresh();
        }}
      />

      <UnitPhotoPicker
        open={mediaOpen}
        sending={attaching}
        onCancel={() => setMediaOpen(false)}
        onSend={(serials) => void attach(serials)}
      />
    </>
  );
}

/** The thread's waiting reservation request, with its two decisions. */
function ChatRequestStrip({ phone }: { readonly phone: string }) {
  const db = useDb();
  const row = pendingRequestFor(db, phone, new Date());
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  if (!row && !approving && !rejecting) return null;
  return (
    <>
      {row && (
        <RequestStrip
          row={row}
          onApprove={() => setApproving(true)}
          onReject={() => setRejecting(true)}
        />
      )}
      <ApproveRequestModal
        row={approving && row ? row : null}
        onClose={() => setApproving(false)}
      />
      <RejectRequestModal
        row={rejecting && row ? row : null}
        onClose={() => setRejecting(false)}
      />
    </>
  );
}
