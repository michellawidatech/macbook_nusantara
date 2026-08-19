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
 * ## Where the data comes from
 *
 * The threads and the conversation are REAL — `/api/inbox`, backed by
 * `WaMessage`. This page used to render the mock store, which meant a message
 * the shop had genuinely received was invisible to everybody who needed to
 * answer it. It polls, because a customer writing in is not something a staff
 * member clicked, so there is no other moment to refetch on.
 *
 * The persona and the corrections are still local to the browser, and that is a
 * known gap rather than an oversight: `schema.prisma` has no `Persona` or
 * `Correction` table, and this build does not invent schema (CLAUDE.md). They
 * survive a reload and not a different machine. The banner below says so, since
 * a shop with three staff would otherwise assume everyone shares one voice.
 *
 * The wording on this page is deliberately plain. It used to say things like
 * "agent summary" and "escalate to human"; a person who has never used the app
 * should be able to work out what every button does without being told, so the
 * buttons now say what happens when you press them.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { PageContainer } from "../../components/PageContainer";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import {
  agentStatus,
  draftReply,
  type AgentStatus,
} from "../../lib/chatApi.js";
import { sendReply } from "../../lib/inboxApi.js";
import { useInbox } from "../../hooks/useInbox.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { Persona } from "../../mock/seed.js";

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

export function ChatPage() {
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const {
    token: { colorPrimaryBg, colorFillTertiary, colorBorderSecondary },
  } = theme.useToken();
  const [picked, setPicked] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
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

  // Asked once on load, so the page can explain a switched-off bot before
  // anyone presses a button that would fail.
  useEffect(() => {
    agentStatus()
      .then(setStatus)
      .catch(() => setStatusError(true));
  }, []);

  const persona =
    db.personas.find((p) => p.id === db.activePersonaId) ?? db.personas[0];

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
    db.corrections.find((c) => c.messageId === messageId)?.corrected;

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
      const result = await draftReply({
        persona: persona.prompt,
        turns,
        corrections: db.corrections.map((c) => ({
          original: c.original,
          corrected: c.corrected,
          note: c.note,
        })),
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
    fixForm.validateFields().then((v) => {
      const target = fixing;
      if (!target) return;
      const original = target.text;
      if (v.corrected.trim() === original.trim()) {
        setFixing(null);
        return;
      }
      mutate((d) => {
        d.corrections.push({
          id: nextId("corr"),
          threadPhone: active ?? "",
          messageId: target.messageId,
          original,
          corrected: v.corrected.trim(),
          note: v.note?.trim() || undefined,
          at: new Date().toISOString(),
          staff: "Michella",
        });
      });
      setFixing(null);
      message.success(
        "Saved. The bot will see this before it writes anything else.",
      );
    });

  const openPersona = (p: Persona | "new") => {
    setEditingPersona(p);
    personaForm.setFieldsValue(
      p === "new"
        ? { name: "", blurb: "", prompt: "" }
        : { name: p.name, blurb: p.blurb, prompt: p.prompt },
    );
  };

  const savePersona = () =>
    personaForm.validateFields().then((v) => {
      mutate((d) => {
        if (editingPersona === "new") {
          const id = nextId("persona");
          d.personas.push({ ...v, id, builtIn: false });
          d.activePersonaId = id;
        } else if (editingPersona) {
          const p = d.personas.find((x) => x.id === editingPersona.id);
          if (p) Object.assign(p, v);
        }
      });
      setEditingPersona(null);
      message.success("Saved.");
    });

  const agentBanner = statusError ? (
    <Alert
      type="warning"
      showIcon
      title="Can't reach the server"
      description="The bot needs the API running on port 4000. Without it there are no chats to show."
    />
  ) : status && !status.enabled ? (
    <Alert
      type="info"
      showIcon
      title="The bot is switched off"
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
        title="Couldn't refresh just now"
        description="Showing the last chats that loaded. It will try again in a few seconds."
      />
    ) : null;

  return (
    <PageContainer title="Chat Inbox">
      <Flex vertical gap={16} style={{ flex: 1 }}>
        {agentBanner}
        {loadBanner}

        <Flex
          gap={16}
          vertical={compact}
          style={{ flex: 1, minHeight: compact ? undefined : 520 }}
        >
          {showList && (
            <Card
              style={compact ? undefined : { width: 280, flexShrink: 0 }}
              styles={{ body: { padding: 0 } }}
              title="Chats"
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
                      <Empty description="No chats yet. Anything a customer sends on WhatsApp shows up here." />
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
                <Empty description="Pick a chat on the left." />
              )}
            </Card>
          ) : (
            <>
              <Card
                style={{ flex: 1, display: "flex", flexDirection: "column" }}
                styles={{
                  body: { flex: 1, display: "flex", flexDirection: "column" },
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
                        aria-label="Back to chats"
                        onClick={() => setPicked(null)}
                      />
                    )}
                    <span>{conversation.name ?? conversation.phone}</span>
                    <Typography.Text type="secondary">
                      {conversation.phone}
                    </Typography.Text>
                  </Flex>
                }
              >
                <Flex
                  vertical
                  gap={12}
                  style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}
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
                              written by the bot
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
                              <Tooltip title="Rewrite this the way it should have been said. The bot learns from it.">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  aria-label="Fix this message"
                                  onClick={() => openFix(b)}
                                >
                                  Fix this
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
                    title="Too late to reply freely"
                    description="WhatsApp only delivers a free reply within 24 hours of the customer's last message. This one has passed, so anything typed here would not arrive. Reach them another way, or wait for them to write again."
                  />
                )}

                <Flex gap={8} vertical={compact}>
                  <Input.TextArea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    disabled={!windowOpen}
                    placeholder="Type your reply, or press Write it for me and edit what comes back."
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
                        Write it for me
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={sending}
                      disabled={!reply.trim() || !windowOpen}
                      onClick={send}
                    >
                      Send
                    </Button>
                  </Flex>
                </Flex>
              </Card>

              {!compact && (
                <Card
                  style={{ width: 300, flexShrink: 0 }}
                  title="The bot"
                  extra={
                    <Button size="small" onClick={() => setPersonaOpen(true)}>
                      Change
                    </Button>
                  }
                >
                  <Flex vertical gap={12}>
                    <div>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        How it talks
                      </Typography.Text>
                      <div>
                        <Typography.Text strong>
                          {persona?.name}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary">
                        {persona?.blurb}
                      </Typography.Text>
                    </div>

                    <div>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        What it has learned
                      </Typography.Text>
                      <div>
                        <Typography.Text strong>
                          {db.corrections.length} fix
                          {db.corrections.length === 1 ? "" : "es"}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary">
                        Every time you press "Fix this", the bot reads your
                        version before it writes anything else.
                      </Typography.Text>
                    </div>

                    <div>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        This chat
                      </Typography.Text>
                      <div>
                        <Typography.Text strong>
                          {conversation.messages.length} message
                          {conversation.messages.length === 1 ? "" : "s"}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary">
                        {thread?.needsReply
                          ? "Waiting on an answer."
                          : "Nothing waiting on you here."}
                      </Typography.Text>
                    </div>

                    {/* Said plainly, because a shop with three staff would
                        otherwise assume everyone shares one voice and one set
                        of fixes. They do not — there is no table for either. */}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      The voice and the fixes are saved in this browser only.
                      Another computer sees its own.
                    </Typography.Text>

                    {status?.mode === "oauth" && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        Running on a Claude subscription login. These tokens
                        expire — if drafts stop working, make a new one.
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
        title="How the bot talks"
        open={personaOpen}
        onClose={() => setPersonaOpen(false)}
        size={compact ? "large" : "default"}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openPersona("new")}
          >
            New voice
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
          title="Drafts only, for now"
          description="This voice is used when you press “Write it for me”. Messages the bot answers on its own use its built-in voice, because there is nowhere on the server to save this one yet."
        />
        <Flex vertical gap={12}>
          {db.personas.map((p) => (
            <Card
              key={p.id}
              size="small"
              style={{
                borderColor:
                  p.id === db.activePersonaId ? colorPrimaryBg : undefined,
                background:
                  p.id === db.activePersonaId ? colorPrimaryBg : undefined,
              }}
              title={
                <Flex align="center" gap={8}>
                  <span>{p.name}</span>
                  {p.builtIn && <Tag>built in</Tag>}
                  {p.id === db.activePersonaId && (
                    <Tag color="green">in use</Tag>
                  )}
                </Flex>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openPersona(p)}
                  />
                  {p.id !== db.activePersonaId && (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        mutate((d) => {
                          d.activePersonaId = p.id;
                        });
                        message.success(`The bot now talks like "${p.name}".`);
                      }}
                    >
                      Use this
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
        okText="Save"
        width={compact ? "100%" : 640}
      >
        <Form form={personaForm} layout="vertical">
          <Form.Item name="name" label="Name it" rules={[{ required: true }]}>
            <Input placeholder="e.g. Friendly shop admin" />
          </Form.Item>
          <Form.Item
            name="blurb"
            label="One line about it"
            rules={[{ required: true }]}
          >
            <Input placeholder="e.g. Casual Indonesian, short messages" />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="Tell the bot who to be"
            tooltip="Write it as if you were briefing a new member of staff on their first day"
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
        title="Say it the right way"
        open={fixing !== null}
        onCancel={() => setFixing(null)}
        onOk={saveFix}
        okText="Save the fix"
        width={compact ? "100%" : 640}
      >
        <Typography.Paragraph type="secondary">
          Rewrite the message the way it should have been sent. The bot reads
          every fix you have made before it writes anything else, so it stops
          making the same mistake.
        </Typography.Paragraph>
        <Card size="small" style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            What was sent
          </Typography.Text>
          <div>{fixing?.text}</div>
        </Card>
        <Form form={fixForm} layout="vertical">
          <Form.Item
            name="corrected"
            label="What it should have said"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="note" label="Why (optional)">
            <Input placeholder="e.g. too formal, and we never use exclamation marks" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
