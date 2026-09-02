/**
 * The chat inbox: customer messages on the left, the conversation in the
 * middle, and the bot's controls on the right.
 *
 * Three things staff do here, and the page is arranged around them:
 *
 *  1. **Read and reply.** Ordinary inbox.
 *  2. **Ask the bot to write the reply.** The draft lands in the reply box, not
 *     in the customer's chat — nothing is ever sent from this page without a
 *     person pressing Send. (The worker answers unattended messages on its own;
 *     that is a different path, and this one stays under a human's hand.)
 *  3. **Fix what the bot got wrong.** Every message the bot wrote carries a
 *     "Fix this" button. The rewrite is stored and replayed into every later
 *     prompt as an example, which is the whole learning loop: no fine-tuning,
 *     no training run, the model simply reads its own past mistakes before it
 *     writes the next line.
 *
 * ## Layout
 *
 * Three panes that scroll independently inside a fixed viewport: the chat
 * list, the conversation, and the context panel. Each one is a flex column
 * with `minHeight: 0` all the way up to `PageContainer fill`, because a flex
 * item defaults to `min-height: auto` and refuses to shrink below its content
 * — which is why the message list carried an `overflowY: auto` that had never
 * once scrolled. No fixed pixel heights.
 *
 * ## Where the data comes from
 *
 * The threads and the conversation are REAL — `/api/inbox`, backed by
 * `WaMessage`. This page used to render the mock store, which meant a message
 * the shop had genuinely received was invisible to everybody who needed to
 * answer it. It polls, because a customer writing in is not something a staff
 * member clicked, so there is no other moment to refetch on.
 *
 * The persona and the corrections are real rows too, read through
 * `/api/chat/personas` and `/api/chat/corrections`. That matters more than it
 * sounds: while they lived in this browser, editing the voice here changed
 * what a staff member drafted and not one word of what the bot said
 * unattended, because the worker has no browser to read them from. Now both
 * read what the worker reads.
 *
 * The customer block and the chat summary are read straight from
 * `/api/inbox/:phone`. The summary is written by the worker's summary pass
 * into `WaThreadMemory` every few answered turns. This page never composes one
 * from the raw messages, and it says "no summary yet" rather than inventing
 * one — a plausible-looking profile is worse than an honest blank.
 *
 * The wording on this page is deliberately plain. It used to say things like
 * "agent summary" and "escalate to human"; a person who has never used the app
 * should be able to work out what every button does without being told, so the
 * buttons now say what happens when you press them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Divider,
  App,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import {
  agentStatus,
  draftReply,
  type Persona,
  type AgentStatus,
} from "../../lib/chatApi.js";
import { sendReply, setAutoReply } from "../../lib/inboxApi.js";
import { useInbox } from "../../hooks/useInbox.js";
import { useAgentConfig } from "../../hooks/useAgentConfig.js";
import { useTranslation } from "react-i18next";

/**
 * One line in the conversation.
 *
 * A `WaMessage` row can produce two of these: what the customer wrote, and the
 * answer stored on the same row. Flattening them here keeps the render loop
 * from having to know that a reply is a column rather than a row.
 */
interface Bubble {
  key: string;
  /** The `WaMessage` id, so a correction can be filed against it. */
  messageId: string;
  side: "in" | "out";
  text: string;
  at: string;
  byAgent: boolean;
  by: string | null;
}

/** A labelled block in the context panel. Keeps the three sections identical. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex vertical gap={6}>
      <Typography.Text strong style={{ fontSize: 12, letterSpacing: 0.4 }}>
        {title.toUpperCase()}
      </Typography.Text>
      {children}
    </Flex>
  );
}

/** One fact: a quiet label with the value under it. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <div>
        <Typography.Text strong>{children}</Typography.Text>
      </div>
    </div>
  );
}

export function ChatInbox() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const {
    token: { colorPrimaryBg, colorFillTertiary, colorBorderSecondary },
  } = theme.useToken();
  const [picked, setPicked] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | "new" | null>(
    null,
  );
  const [fixing, setFixing] = useState<Bubble | null>(null);
  const [personaForm] = Form.useForm<{
    name: string;
    blurb: string;
    prompt: string;
  }>();
  const [fixForm] = Form.useForm<{ corrected: string; note?: string }>();

  /**
   * The voice and the corrections, from the server.
   *
   * Both used to come from the browser mock store, which meant an edit here
   * changed what staff drafted and nothing about what the bot said on its own.
   * These are the same rows the worker reads.
   */
  const agent = useAgentConfig();

  /**
   * The message history's scroll box.
   *
   * A conversation opens at the newest message, the way every chat client
   * does, and a reply that arrives while you are reading lands at the bottom
   * without moving the page. Jumping is skipped when you have scrolled up to
   * read something older — yanking the view away mid-sentence is worse than a
   * missed scroll.
   */
  const messagesRef = useRef<HTMLDivElement>(null);

  // Asked once on load, so the page can explain a switched-off bot before
  // anyone presses a button that would fail.
  useEffect(() => {
    agentStatus()
      .then(setStatus)
      .catch(() => setStatusError(true));
  }, []);

  // The live voice. Undefined until loaded, and undefined is legitimate: a
  // fresh shop has no persona row and the server falls back to the built-in
  // one, so the page must not insist on having something to show.
  const persona = agent.active ?? agent.personas[0];

  /**
   * Three panes do not fit on a phone, so a phone shows one at a time: the
   * inbox, or one conversation with a way back. A desktop shows all three and
   * opens the thread that is waiting on a human, because there is room to.
   *
   * Resolved before the fetch, since the hook needs to know which conversation
   * to poll for.
   */
  const [threadsSeen, setThreadsSeen] = useState<string | null>(null);
  const { threads, conversation, loading, error, refresh } = useInbox(
    picked ?? threadsSeen,
  );

  // On a desktop, land on the thread that is waiting — once, so the auto-pick
  // does not yank the view away from a thread the user chose afterwards.
  useEffect(() => {
    if (compact || picked || threadsSeen) return;
    const waiting = threads.find((t) => t.needsReply) ?? threads[0];
    if (waiting) setThreadsSeen(waiting.phone);
  }, [compact, picked, threadsSeen, threads]);

  const active = picked ?? threadsSeen;
  const thread = threads.find((t) => t.phone === active) ?? null;
  const showList = !compact || !active;

  /** The window is open while the API is still handing back a closing time. */
  const windowOpen = conversation ? conversation.windowClosesAt !== null : true;

  /** A staff rewrite of a given message, if one has been filed. */
  const correctionFor = (messageId: string) =>
    agent.corrections.find((c) => c.messageId === messageId)?.corrected;

  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    const distanceFromBottom =
      box.scrollHeight - box.scrollTop - box.clientHeight;
    // Opening a thread has scrollTop 0 and must land at the bottom. After
    // that, only follow along if the reader is already near it.
    if (box.scrollTop === 0 || distanceFromBottom < 240) {
      box.scrollTop = box.scrollHeight;
    }
  }, [active, conversation?.messages.length]);

  const bubbles = useMemo<Bubble[]>(() => {
    if (!conversation) return [];
    const out: Bubble[] = [];
    for (const m of conversation.messages) {
      if (m.text) {
        out.push({
          key: `${m.id}:in`,
          messageId: m.id,
          side: "in",
          text: m.text,
          at: m.at,
          byAgent: false,
          by: null,
        });
      } else {
        // An image, a sticker, a location. Saying what it was beats an empty
        // bubble, which reads as a bug.
        out.push({
          key: `${m.id}:in`,
          messageId: m.id,
          side: "in",
          text: `[${m.msgType}]`,
          at: m.at,
          byAgent: false,
          by: null,
        });
      }
      if (m.reply) {
        out.push({
          key: `${m.id}:out`,
          messageId: m.id,
          side: "out",
          text: m.reply.text,
          at: m.reply.at ?? m.at,
          byAgent: m.reply.byAgent,
          by: m.reply.by,
        });
      }
    }
    return out;
  }, [conversation]);

  const send = async () => {
    const text = reply.trim();
    if (!text || !active) return;
    setSending(true);
    try {
      await sendReply(active, text);
      setReply("");
      // The row is committed; the worker performs the send (08 §5). Saying
      // "queued" rather than "sent" is the difference between a promise the
      // app can keep and one it cannot.
      message.success("Queued. It goes out in a few seconds.");
      refresh();
    } catch (err) {
      // The server's message is the useful one — window closed, not logged in,
      // offline. Repeating a generic failure over the top of it helps nobody.
      message.error(
        err instanceof Error ? err.message : "Could not send the reply.",
      );
    } finally {
      setSending(false);
    }
  };

  /**
   * Hand this one customer to a person, or back to the bot.
   *
   * Not optimistic. Everywhere else on this page an optimistic update is
   * harmless, but this switch is a claim about what happens to a customer while
   * nobody is looking: showing "you are handling this" when the write actually
   * failed is how a message goes unanswered overnight. So the switch waits for
   * the server, and `refresh()` is what moves it — the state on screen is
   * always the state the worker will read.
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
        err instanceof Error
          ? err.message
          : t("chat.couldNotChangeThatSwitch", "Could not change that switch."),
      );
    } finally {
      setSwitching(false);
    }
  };

  /**
   * Ask the bot for a draft.
   *
   * Every correction the shop has ever made goes along with the request. The
   * server caps how many it uses, so this can stay simple and just send them.
   */
  const draft = async () => {
    if (!conversation || !persona) return;
    const turns = bubbles.map((b) => ({
      // A message the shop sent is an `assistant` turn whether a person or the
      // bot wrote it — from the model's side they are the same thing: words
      // this shop has already put in front of this customer.
      role: b.side === "in" ? ("user" as const) : ("assistant" as const),
      text: correctionFor(b.messageId) ?? b.text,
    }));
    if (turns.length === 0) return;

    setDrafting(true);
    try {
      // Persona and corrections are omitted deliberately: the server reads
      // the active persona and the stored corrections itself, so a draft on
      // this page is composed exactly the way the unattended reply is. Sending
      // them here would let the two paths drift apart again.
      const result = await draftReply({
        turns,
        ...(active ? { waId: active } : {}),
      });
      setReply(result.reply);
      message.success(
        result.toolsUsed.length
          ? `Draft ready — it checked ${[...new Set(result.toolsUsed)].join(", ")}.`
          : "Draft ready.",
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Could not get a draft.",
      );
    } finally {
      setDrafting(false);
    }
  };

  const openFix = (b: Bubble) => {
    setFixing(b);
    fixForm.setFieldsValue({
      corrected: correctionFor(b.messageId) ?? b.text,
      note: "",
    });
  };

  const saveFix = () =>
    fixForm.validateFields().then(async (v) => {
      const target = fixing;
      if (!target) return;
      const original = target.text;
      // An identical rewrite teaches nothing and would still occupy one of the
      // twelve slots the prompt has room for. The server refuses it too.
      if (v.corrected.trim() === original.trim()) {
        setFixing(null);
        return;
      }
      try {
        await agent.correct({
          messageId: target.messageId,
          original,
          corrected: v.corrected.trim(),
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
        });
        setFixing(null);
        message.success(
          "Saved. The bot will see this before it writes anything else.",
        );
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "Could not save the fix.",
        );
      }
    });

  const openPersona = (p: Persona | "new") => {
    setEditingPersona(p);
    personaForm.setFieldsValue(
      p === "new"
        ? { name: "", blurb: "", prompt: "" }
        : { name: p.name, blurb: p.blurb ?? "", prompt: p.prompt },
    );
  };

  const savePersona = () =>
    personaForm.validateFields().then(async (v) => {
      try {
        await agent.save(
          editingPersona === "new" ? null : (editingPersona?.id ?? null),
          { name: v.name, blurb: v.blurb, prompt: v.prompt },
        );
        setEditingPersona(null);
        // A new voice is saved switched off. Making one live is a separate,
        // deliberate press, because saving a draft must never silently change
        // what the bot is saying to customers right now.
        message.success(
          editingPersona === "new"
            ? "Saved. Press Use this to make it the live voice."
            : "Saved.",
        );
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "Could not save the persona.",
        );
      }
    });

  const useThisPersona = async (id: string) => {
    try {
      await agent.activate(id);
      message.success(
        "This is what the bot sounds like now, including at 2am.",
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Could not switch the voice.",
      );
    }
  };

  const agentBanner = statusError ? (
    <Alert
      type="warning"
      showIcon
      title={t("chat.canTReachTheServer", "Can't reach the server")}
      description={t(
        "chat.theBotNeedsTheApi",
        "The bot needs the API running on port 4000. Without it there are no chats to show.",
      )}
    />
  ) : status && !status.enabled ? (
    <Alert
      type="info"
      showIcon
      title={t("chat.theBotIsSwitchedOff", "The bot is switched off")}
      description={
        <>
          Nobody has given it a Claude login yet, so it can't write drafts or
          answer on its own. Messages still arrive and you can reply yourself.
          To turn it on, run{" "}
          <Typography.Text code>claude setup-token</Typography.Text> and put the
          token in the API's and the worker's environment as{" "}
          <Typography.Text code>ANTHROPIC_AUTH_TOKEN</Typography.Text>.
        </>
      }
    />
  ) : null;

  // Shown beside the data rather than instead of it: an inbox that empties
  // itself because one poll timed out reads as "all the messages are gone".
  const loadBanner =
    error && !loading ? (
      <Alert
        type="warning"
        showIcon
        title={t("chat.couldnTRefreshJustNow", "Couldn't refresh just now")}
        description={t(
          "chat.showingTheLastChatsThat",
          "Showing the last chats that loaded. It will try again in a few seconds.",
        )}
      />
    ) : null;

  return (
    // No PageContainer of its own since the 2026-08-26 merge: this is now a
    // tab inside `ChatbotPage`, which owns the frame. The fragment keeps the
    // modals as siblings of the pane rather than nesting them inside a
    // scrolling column.
    <>
      <Flex vertical gap={16} style={{ flex: 1, minHeight: 0 }}>
        {agentBanner}
        {loadBanner}

        {/* `minHeight: 0`, never a pixel floor. The old `minHeight: 520` was a
            floor rather than a cap, so this row could only ever grow — which
            is why the message list's own `overflowY: auto` never scrolled. */}
        <Flex gap={16} vertical={compact} style={{ flex: 1, minHeight: 0 }}>
          {showList && (
            <Card
              style={
                compact
                  ? { minHeight: 0 }
                  : {
                      width: 280,
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                    }
              }
              styles={{
                body: {
                  padding: 0,
                  // The list scrolls here and nowhere else. Scrolling it must
                  // not move the conversation beside it.
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                },
              }}
              title={t("chat.chats", "Chats")}
            >
              {loading ? (
                <div style={{ padding: 16 }}>
                  <Skeleton active paragraph={{ rows: 4 }} />
                </div>
              ) : (
                <List
                  dataSource={threads}
                  locale={{
                    emptyText: (
                      <Empty
                        description={t(
                          "chat.noChatsYetAnythingA",
                          "No chats yet. Anything a customer sends on WhatsApp shows up here.",
                        )}
                      />
                    ),
                  }}
                  renderItem={(c) => (
                    <List.Item
                      onClick={() => setPicked(c.phone)}
                      style={{
                        cursor: "pointer",
                        paddingInline: 16,
                        background:
                          c.phone === active ? colorPrimaryBg : undefined,
                      }}
                    >
                      <List.Item.Meta
                        title={
                          <Flex justify="space-between" gap={8}>
                            <span>{c.name ?? c.phone}</span>
                            {/* Which chats a person has taken on, visible
                                without opening each one — otherwise the only
                                way to find them is to click through the list. */}
                            {!c.autoReply && (
                              <Tag color="warning" style={{ marginInline: 0 }}>
                                {t("chat.you", "you")}
                              </Tag>
                            )}
                            {c.needsReply && (
                              <Badge status="error" text="waiting" />
                            )}
                          </Flex>
                        }
                        description={c.lastReply ?? c.lastText ?? "—"}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          )}

          {!active || !conversation ? (
            <Card style={{ flex: 1 }}>
              {loading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : (
                <Empty
                  description={t(
                    "chat.pickAChatOnThe",
                    "Pick a chat on the left.",
                  )}
                />
              )}
            </Card>
          ) : (
            <>
              <Card
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                }}
                styles={{
                  // The card title is outside the body, so it stays put while
                  // the body scrolls. `minHeight: 0` again, one level down.
                  body: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  },
                }}
                title={
                  <Flex align="center" gap={8}>
                    {/* The only way back to the inbox on a phone, where the
                        chat list is not on screen beside this. */}
                    {compact && (
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowLeftOutlined />}
                        aria-label={t("chat.backToChats", "Back to chats")}
                        onClick={() => setPicked(null)}
                      />
                    )}
                    <span>{conversation.name ?? conversation.phone}</span>
                    <Typography.Text type="secondary">
                      {conversation.phone}
                    </Typography.Text>
                  </Flex>
                }
                /**
                 * The switch lives in the conversation header rather than in
                 * the Context panel beside it, for two reasons. It is the one
                 * control on this page that decides what happens to a customer
                 * while nobody is watching, so it belongs next to that
                 * customer's name and not in a panel of read-only facts. And
                 * the panel is not rendered on a phone at all — put here, the
                 * switch is reachable in every layout instead of only on a
                 * laptop.
                 */
                extra={
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
                    {/* Labelled, not a bare switch. "On"/"Off" beside a toggle
                        reads as the state, which is ambiguous about what is on;
                        naming the thing that is switched is not. */}
                    <Flex align="center" gap={8}>
                      <Typography.Text
                        type={
                          conversation.autoReply.enabled
                            ? undefined
                            : "warning"
                        }
                      >
                        {conversation.autoReply.enabled
                          ? t("chat.botAnswers", "Bot answers")
                          : t("chat.youAnswer", "You answer")}
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
                }
              >
                {/* The message history. `minHeight: 0` is what finally makes
                    this `overflowY: auto` do anything: without it this flex
                    item sizes to its content and pushes the page taller
                    instead of scrolling. The composer below stays put. */}
                <Flex
                  ref={messagesRef}
                  vertical
                  gap={12}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    paddingBottom: 12,
                  }}
                >
                  {bubbles.map((b) => {
                    const mine = b.side === "out";
                    const corrected = mine
                      ? correctionFor(b.messageId)
                      : undefined;
                    const shown = corrected ?? b.text;
                    return (
                      <Flex
                        key={b.key}
                        justify={mine ? "flex-end" : "flex-start"}
                      >
                        <div
                          style={{
                            maxWidth: "78%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            background: mine
                              ? colorPrimaryBg
                              : colorFillTertiary,
                            border: `1px solid ${colorBorderSecondary}`,
                          }}
                        >
                          {mine && b.byAgent && (
                            <Tag color="blue" icon={<RobotOutlined />}>
                              {t("chat.writtenByTheBot", "written by the bot")}
                            </Tag>
                          )}
                          {mine && !b.byAgent && b.by && <Tag>{b.by}</Tag>}
                          <div>{shown}</div>
                          {corrected && (
                            <Typography.Text
                              delete
                              type="secondary"
                              style={{ display: "block", fontSize: 12 }}
                            >
                              {b.text}
                            </Typography.Text>
                          )}
                          <Flex justify="space-between" align="center" gap={12}>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {fmtDateTime(b.at)}
                            </Typography.Text>
                            {/* Only on what the shop said — there is nothing to
                                correct about what the customer wrote. */}
                            {mine && (
                              <Tooltip
                                title={t(
                                  "chat.rewriteThisTheWayIt",
                                  "Rewrite this the way it should have been said. The bot learns from it.",
                                )}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  aria-label={t(
                                    "chat.fixThisMessage",
                                    "Fix this message",
                                  )}
                                  onClick={() => openFix(b)}
                                >
                                  {t("chat.fixThis", "Fix this")}
                                </Button>
                              </Tooltip>
                            )}
                          </Flex>
                        </div>
                      </Flex>
                    );
                  })}
                </Flex>

                {/* 06 §11: outside the 24-hour window a free-form reply cannot
                    be delivered, and a reply box that looks functional but
                    silently cannot deliver is worse than a disabled one. */}
                {!windowOpen && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 8 }}
                    title={t(
                      "chat.tooLateToReplyFreely",
                      "Too late to reply freely",
                    )}
                    description={t(
                      "chat.whatsappOnlyDeliversAFree",
                      "WhatsApp only delivers a free reply within 24 hours of the customer's last message. This one has passed, so anything typed here would not arrive. Reach them another way, or wait for them to write again.",
                    )}
                  />
                )}

                <Flex gap={8} vertical={compact}>
                  <Input.TextArea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    disabled={!windowOpen}
                    placeholder={t(
                      "chat.typeYourReplyOrPress",
                      "Type your reply, or press Write it for me and edit what comes back.",
                    )}
                  />
                  <Flex gap={8} vertical={!compact}>
                    <Tooltip
                      title={
                        status?.enabled
                          ? "The bot reads this chat and writes a reply for you. Nothing is sent until you press Send."
                          : "Needs a Claude login on the server"
                      }
                    >
                      <Button
                        icon={<ThunderboltOutlined />}
                        loading={drafting}
                        disabled={!status?.enabled || !windowOpen}
                        onClick={draft}
                      >
                        {t("chat.writeItForMe", "Write it for me")}
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={sending}
                      disabled={!reply.trim() || !windowOpen}
                      onClick={send}
                    >
                      {t("chat.send", "Send")}
                    </Button>
                  </Flex>
                </Flex>
              </Card>

              {!compact && (
                <Card
                  style={{
                    width: 300,
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  }}
                  styles={{
                    // Scrolls on its own once the summaries get long. It must
                    // never be what makes the page taller.
                    body: { flex: 1, minHeight: 0, overflowY: "auto" },
                  }}
                  title={t("chat.context", "Context")}
                  extra={
                    <Button size="small" onClick={() => setPersonaOpen(true)}>
                      {t("chat.change", "Change")}
                    </Button>
                  }
                >
                  <Flex vertical gap={16}>
                    <Section title={t("chat.theBot", "The bot")}>
                      {/* The control is in the conversation header; this is
                          the provenance, which is the part that does not fit
                          beside a switch. `by`/`at` are null until somebody
                          actually flips it — a chat nobody has ruled on is on
                          by default, and naming a person who never touched it
                          would be a lie. */}
                      <Field
                        label={t("chat.onThisChat", "On this chat")}
                      >
                        {conversation.autoReply.enabled
                          ? t("chat.answersOnItsOwn", "Answers on its own")
                          : t("chat.offYouReAnswering", "Off — you're answering")}
                      </Field>
                      {conversation.autoReply.at && (
                        <Typography.Text type="secondary">
                          {conversation.autoReply.by
                            ? `${conversation.autoReply.by}, ${fmtDateTime(conversation.autoReply.at)}`
                            : fmtDateTime(conversation.autoReply.at)}
                        </Typography.Text>
                      )}
                      <Field label={t("chat.voice", "Voice")}>
                        {persona?.name ?? "Built in"}
                      </Field>
                      {persona?.blurb && (
                        <Typography.Text type="secondary">
                          {persona.blurb}
                        </Typography.Text>
                      )}
                      <Field
                        label={t(
                          "chat.whatItHasLearned",
                          "What it has learned",
                        )}
                      >
                        {agent.corrections.length} fix
                        {agent.corrections.length === 1 ? "" : "es"}
                      </Field>
                      <Typography.Text type="secondary">
                        Every time you press "Fix this", the bot reads your
                        version before it writes anything else.
                      </Typography.Text>
                    </Section>

                    <Divider style={{ margin: 0 }} />

                    <Section title={t("chat.customer", "Customer")}>
                      {conversation.customer ? (
                        <>
                          <Field label={t("chat.name", "Name")}>
                            {conversation.customer.name}
                          </Field>
                          <Field label={t("chat.phone", "Phone")}>
                            {conversation.customer.phone}
                          </Field>
                          <Field
                            label={t("chat.customerSince", "Customer since")}
                          >
                            {fmtDateTime(conversation.customer.since).slice(
                              0,
                              10,
                            )}
                          </Field>
                          <Field label={t("chat.bought", "Bought")}>
                            {conversation.customer.orderCount} order
                            {conversation.customer.orderCount === 1 ? "" : "s"}
                          </Field>
                          {conversation.customer.lastOrder && (
                            <Typography.Text type="secondary">
                              Last: {conversation.customer.lastOrder.code} on{" "}
                              {fmtDateTime(
                                conversation.customer.lastOrder.at,
                              ).slice(0, 10)}
                            </Typography.Text>
                          )}
                          {conversation.customer.openReservations > 0 && (
                            <Typography.Text type="secondary">
                              {conversation.customer.openReservations} booking
                              {conversation.customer.openReservations === 1
                                ? ""
                                : "s"}{" "}
                              still open.
                            </Typography.Text>
                          )}
                          {conversation.customer.referralSource && (
                            <Typography.Text type="secondary">
                              Found us through{" "}
                              {conversation.customer.referralSource}.
                            </Typography.Text>
                          )}
                        </>
                      ) : (
                        /* Nothing is invented here. An unknown number is an
                           unknown number, and saying so is more use to a staff
                           member than a plausible-looking blank profile. */
                        <Typography.Text type="secondary">
                          No customer summary yet. This number has not bought
                          anything, so the shop knows only what is in this
                          conversation.
                        </Typography.Text>
                      )}
                    </Section>

                    <Divider style={{ margin: 0 }} />

                    <Section title={t("chat.thisChat", "This chat")}>
                      <Field label={t("chat.messages", "Messages")}>
                        {conversation.messages.length}
                      </Field>
                      <Field label={t("chat.status", "Status")}>
                        {thread?.needsReply
                          ? "Waiting on an answer."
                          : "Nothing waiting on you here."}
                      </Field>

                      {/* Written by the worker's summary pass, not by this
                          page. The browser never composes one from raw
                          messages. */}
                      {conversation.summary ? (
                        <>
                          <Typography.Paragraph
                            style={{ marginBottom: 4, whiteSpace: "pre-wrap" }}
                          >
                            {conversation.summary.text}
                          </Typography.Paragraph>
                          {conversation.summary.at && (
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              Written by the bot,{" "}
                              {fmtDateTime(conversation.summary.at)}.
                            </Typography.Text>
                          )}
                        </>
                      ) : (
                        <Typography.Text type="secondary">
                          No chat summary yet. The bot writes one once a
                          conversation has a few answered turns.
                        </Typography.Text>
                      )}

                      {conversation.directive && (
                        <Alert
                          type="info"
                          showIcon
                          title={t(
                            "chat.yourNoteToTheBot",
                            "Your note to the bot",
                          )}
                          description={conversation.directive}
                        />
                      )}
                    </Section>

                    <Divider style={{ margin: 0 }} />

                    {/* The voice and the fixes are rows on the server now, so
                        every computer and the unattended worker all read the
                        same ones. */}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      The voice and the fixes are saved on the server. Every
                      computer sees the same ones, and so does the bot when it
                      answers on its own.
                    </Typography.Text>

                    {status?.mode === "oauth" && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        Running on a Claude subscription login. These tokens
                        expire, so if drafts stop working make a new one.
                      </Typography.Text>
                    )}
                  </Flex>
                </Card>
              )}
            </>
          )}
        </Flex>
      </Flex>

      <Drawer
        title={t("chat.howTheBotTalks", "How the bot talks")}
        open={personaOpen}
        onClose={() => setPersonaOpen(false)}
        size={compact ? "large" : "default"}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openPersona("new")}
          >
            {t("chat.newVoice", "New voice")}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Pick how the bot should sound. You can edit any of these, or write
          your own.
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("chat.thisIsTheBotS", "This is the bot's real voice")}
          description={t(
            "chat.whateverIsInUseHere",
            "Whatever is in use here is what the bot sounds like everywhere, including the messages it answers on its own at 3am. Changing it changes what customers get.",
          )}
        />
        <Flex vertical gap={12}>
          {agent.personas.map((p) => (
            <Card
              key={p.id}
              size="small"
              style={{
                borderColor: p.active ? colorPrimaryBg : undefined,
                background: p.active ? colorPrimaryBg : undefined,
              }}
              title={
                <Flex align="center" gap={8}>
                  <span>{p.name}</span>
                  {p.builtIn && <Tag>built in</Tag>}
                  {p.active && <Tag color="green">in use</Tag>}
                </Flex>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openPersona(p)}
                  />
                  {!p.active && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => void useThisPersona(p.id)}
                    >
                      {t("chat.useThis", "Use this")}
                    </Button>
                  )}
                </Space>
              }
            >
              <Typography.Text type="secondary">{p.blurb}</Typography.Text>
            </Card>
          ))}
        </Flex>
      </Drawer>

      <Modal
        title={
          editingPersona === "new" ? "Write a new voice" : "Edit this voice"
        }
        open={editingPersona !== null}
        onCancel={() => setEditingPersona(null)}
        onOk={savePersona}
        okText={t("chat.save", "Save")}
        width={compact ? "100%" : 640}
      >
        <Form form={personaForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("chat.nameIt", "Name it")}
            rules={[{ required: true }]}
          >
            <Input
              placeholder={t(
                "chat.eGFriendlyShopAdmin",
                "e.g. Friendly shop admin",
              )}
            />
          </Form.Item>
          <Form.Item
            name="blurb"
            label={t("chat.oneLineAboutIt", "One line about it")}
            rules={[{ required: true }]}
          >
            <Input
              placeholder={t(
                "chat.eGCasualIndonesianShort",
                "e.g. Casual Indonesian, short messages",
              )}
            />
          </Form.Item>
          <Form.Item
            name="prompt"
            label={t("chat.tellTheBotWhoTo", "Tell the bot who to be")}
            tooltip={t(
              "chat.writeItAsIfYou",
              "Write it as if you were briefing a new member of staff on their first day",
            )}
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={10} />
          </Form.Item>
          <Typography.Text type="secondary">
            Whatever you write here, the bot is never allowed to make up a price
            or claim something is in stock when it is not. That rule sits above
            this box.
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={t("chat.sayItTheRightWay", "Say it the right way")}
        open={fixing !== null}
        onCancel={() => setFixing(null)}
        onOk={saveFix}
        okText={t("chat.saveTheFix", "Save the fix")}
        width={compact ? "100%" : 640}
      >
        <Typography.Paragraph type="secondary">
          Rewrite the message the way it should have been sent. The bot reads
          every fix you have made before it writes anything else, so it stops
          making the same mistake.
        </Typography.Paragraph>
        <Card size="small" style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("chat.whatWasSent", "What was sent")}
          </Typography.Text>
          <div>{fixing?.text}</div>
        </Card>
        <Form form={fixForm} layout="vertical">
          <Form.Item
            name="corrected"
            label={t("chat.whatItShouldHaveSaid", "What it should have said")}
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item
            name="note"
            label={t("chat.whyOptional", "Why (optional)")}
          >
            <Input
              placeholder={t(
                "chat.eGTooFormalAnd",
                "e.g. too formal, and we never use exclamation marks",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
