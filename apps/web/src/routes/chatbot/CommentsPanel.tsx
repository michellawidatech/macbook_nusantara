/**
 * Chatbot → Comments (2026-11-16, docs/superpowers/specs/2026-11-16-instagram-design.md):
 * the comments people leave on the shop's Instagram posts, newest first.
 *
 * One row per comment: the post it is on (thumbnail, caption, a link to it on
 * Instagram), who wrote it, what they wrote and when, its status, and what the
 * shop already answered — publicly or by DM, and by whom ("Bot" for the
 * auto-reply). Four actions, each queued by the server for the worker and
 * audited with who pressed it:
 *
 *  - **Reply publicly** — a reply under the comment, written in place.
 *  - **Send DM** — Instagram's "private reply": ONE per comment, within 7
 *    days of it. The button says so on hover once it is no longer possible.
 *    The box starts from the owner's DM template (Settings → Instagram).
 *  - **Hide / Unhide** on Instagram.
 *  - **Mark done / Reopen** — dealt with, without answering here. Not while
 *    hidden (the server refuses it too): unhide first.
 *
 * Filters: a chip per status with its count ("All" first), a post, and a
 * search over the words, the @username and the caption. Polled every 30
 * seconds, as the waiting notice is: a comment is something a customer did,
 * not something staff clicked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  InstagramOutlined,
  MessageOutlined,
  RobotOutlined,
  RollbackOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "../../i18n/translate.js";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  getInstagramSettings,
  hideComment,
  IG_COMMENT_STATUSES,
  IG_TEXT_MAX_BYTES,
  listComments,
  listPosts,
  markCommentDone,
  privateReply,
  replyToComment,
  utf8Bytes,
  type IgComment,
  type IgCommentCounts,
  type IgCommentStatus,
  type IgPost,
} from "../../lib/instagramApi.js";
import { refreshChatWaiting } from "../../hooks/useChatWaiting.js";

/** As often as the waiting notice asks. */
export const COMMENTS_POLL_MS = 30_000;

const STATUS_COLOR: Record<IgCommentStatus, string> = {
  NEW: "orange",
  REPLIED: "blue",
  DMED: "purple",
  DONE: "green",
  HIDDEN: "default",
};

/** A status in words. Literal `t()` calls, for test/i18n.test.ts. */
export function commentStatusLabel(t: TFunction, s: IgCommentStatus): string {
  switch (s) {
    case "NEW":
      return t("igComments.status.new", "New");
    case "REPLIED":
      return t("igComments.status.replied", "Replied");
    case "DMED":
      return t("igComments.status.dmed", "DMed");
    case "DONE":
      return t("igComments.status.done", "Done");
    case "HIDDEN":
      return t("igComments.status.hidden", "Hidden");
  }
}

/** A caption for the post filter: its first words, or "Post" and a date. */
function postLabel(t: TFunction, p: IgPost): string {
  const caption = p.caption?.replace(/\s+/g, " ").trim();
  const head = caption
    ? caption.length > 60
      ? `${caption.slice(0, 60)}…`
      : caption
    : t("igComments.untitledPost", "Post without a caption");
  return `${head} (${p.comments})`;
}

const EMPTY_COUNTS: IgCommentCounts = {
  NEW: 0,
  REPLIED: 0,
  DMED: 0,
  DONE: 0,
  HIDDEN: 0,
};

export function CommentsPanel() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [status, setStatus] = useState<IgCommentStatus | null>(null);
  const [post, setPost] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [comments, setComments] = useState<IgComment[]>([]);
  const [counts, setCounts] = useState<IgCommentCounts>(EMPTY_COUNTS);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [dmTemplate, setDmTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  // Read by the poll, which must not restart because either changed.
  const shown = useRef(0);
  shown.current = comments.length;
  const toast = useRef(message);
  toast.current = message;

  // The search is sent a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        const answer = await listComments(
          { status, media: post, q: query },
          mine.signal,
        );
        if (cancelled || mine.signal.aborted) return;
        setComments(answer.comments);
        setCounts({ ...EMPTY_COUNTS, ...answer.counts });
      } catch (err) {
        if (cancelled || mine.signal.aborted) return;
        // A poll that fails keeps what is on screen; only say so when there
        // is nothing to keep.
        if (
          err instanceof Error &&
          err.name !== "AbortError" &&
          shown.current === 0
        )
          toast.current.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, COMMENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller?.abort();
    };
  }, [status, post, query, nonce]);

  // The posts for the filter, and the owner's DM wording — once.
  useEffect(() => {
    listPosts()
      .then((r) => setPosts(r.media))
      .catch(() => setPosts([]));
    getInstagramSettings()
      .then((s) => setDmTemplate(s.dmTemplate))
      .catch(() => setDmTemplate(""));
  }, []);

  /** A row answered: the comment as it now stands, then the counts. */
  const changed = (next: IgComment) => {
    setComments((list) => list.map((c) => (c.id === next.id ? next : c)));
    refresh();
    refreshChatWaiting();
  };

  const total = IG_COMMENT_STATUSES.reduce((n, s) => n + counts[s], 0);
  const filtered = status !== null || post !== null || query !== "";

  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={8} align="center">
        <Flex
          wrap
          gap={6}
          role="group"
          aria-label={t("igComments.filterStatus", "Filter comments by status")}
        >
          <Tag.CheckableTag
            checked={status === null}
            onChange={() => setStatus(null)}
            data-filter="all"
          >
            {t("igComments.all", "All")} ({total})
          </Tag.CheckableTag>
          {IG_COMMENT_STATUSES.map((s) => (
            <Tag.CheckableTag
              key={s}
              checked={status === s}
              onChange={() => setStatus(status === s ? null : s)}
              data-filter={s}
            >
              {commentStatusLabel(t, s)} ({counts[s]})
            </Tag.CheckableTag>
          ))}
        </Flex>
        <Select<string>
          allowClear
          showSearch={{ optionFilterProp: "label" }}
          value={post ?? undefined}
          onChange={(v) => setPost(v ?? null)}
          placeholder={t("igComments.allPosts", "All posts")}
          aria-label={t("igComments.post", "Post")}
          style={{ minWidth: 220, flex: "0 1 320px" }}
          options={posts.map((p) => ({ value: p.id, label: postLabel(t, p) }))}
        />
        <Input.Search
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => setQuery(v.trim())}
          placeholder={t(
            "igComments.search",
            "Search comments, @username or caption",
          )}
          aria-label={t("igComments.searchLabel", "Search comments")}
          style={{ flex: "1 1 240px", maxWidth: 360 }}
        />
      </Flex>

      {loading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
      ) : comments.length === 0 ? (
        <Card>
          <Empty
            description={
              filtered
                ? t("igComments.noneMatch", "No comments match.")
                : t(
                    "igComments.noneYet",
                    "No comments yet. Comments on the shop's Instagram posts show up here.",
                  )
            }
          />
        </Card>
      ) : (
        <Flex
          vertical
          gap={10}
          role="list"
          aria-label={t("igComments.list", "Comments")}
        >
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              dmTemplate={dmTemplate}
              onChanged={changed}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

type Composer = "reply" | "dm" | null;

function CommentRow({
  comment: c,
  dmTemplate,
  onChanged,
}: {
  readonly comment: IgComment;
  readonly dmTemplate: string;
  readonly onChanged: (next: IgComment) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const {
    token: { colorFillTertiary, colorTextSecondary, colorBorderSecondary },
  } = theme.useToken();
  const [composer, setComposer] = useState<Composer>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"reply" | "dm" | "hide" | "done" | null>(
    null,
  );

  const who = c.username
    ? `@${c.username.replace(/^@/, "")}`
    : t("chat.ig.unnamed", "Instagram user");
  const hidden = c.status === "HIDDEN";
  const done = c.status === "DONE";
  const bytes = utf8Bytes(text);
  const tooLong = bytes > IG_TEXT_MAX_BYTES;

  const open = (which: Composer) => {
    if (composer === which) {
      setComposer(null);
      return;
    }
    setComposer(which);
    setText(which === "dm" ? dmTemplate : "");
  };

  const run = async (
    kind: "reply" | "dm" | "hide" | "done",
    action: () => Promise<IgComment>,
    success: string,
  ) => {
    setBusy(kind);
    try {
      const next = await action();
      message.success(success);
      if (kind === "reply" || kind === "dm") {
        setComposer(null);
        setText("");
      }
      onChanged(next);
    } catch (err) {
      message.error(
        err instanceof Error && err.message
          ? err.message
          : t("igComments.failed", "Could not do that. Try again."),
      );
    } finally {
      setBusy(null);
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body || tooLong || !composer) return;
    if (composer === "reply")
      void run(
        "reply",
        () => replyToComment(c.id, body),
        t(
          "igComments.replyQueued",
          "Reply queued. It goes out in a few seconds.",
        ),
      );
    else
      void run(
        "dm",
        () => privateReply(c.id, body),
        t("igComments.dmQueued", "DM queued. It goes out in a few seconds."),
      );
  };

  const by = (byAgent: boolean, name: string | null) =>
    byAgent ? t("chat.bot", "Bot") : (name ?? t("chat.staff", "Staff"));

  return (
    <Card
      size="small"
      role="listitem"
      data-comment={c.id}
      styles={{ body: { padding: 12 } }}
    >
      <Flex gap={12} align="flex-start">
        <PostThumb comment={c} />
        <Flex vertical gap={6} style={{ flex: 1, minWidth: 0 }}>
          {/* The post it is on: its caption, clamped, and a link to it. */}
          <Flex gap={8} align="baseline" style={{ minWidth: 0 }}>
            <Typography.Text
              type="secondary"
              ellipsis={{ tooltip: c.media.caption ?? undefined }}
              style={{ fontSize: 12, minWidth: 0, flex: 1 }}
            >
              {c.media.caption?.replace(/\s+/g, " ").trim() ||
                t("igComments.untitledPost", "Post without a caption")}
            </Typography.Text>
            {c.media.permalink && (
              <Typography.Link
                href={c.media.permalink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, flexShrink: 0 }}
              >
                {t("igComments.openPost", "Open post")}
              </Typography.Link>
            )}
          </Flex>

          <Flex gap={8} align="center" wrap>
            <Typography.Text strong>{who}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fmtDateTime(c.at)}
            </Typography.Text>
            <Tag color={STATUS_COLOR[c.status]} data-status={c.status}>
              {commentStatusLabel(t, c.status)}
            </Tag>
            {c.isReply && (
              <Tag>{t("igComments.isReply", "Reply to a comment")}</Tag>
            )}
          </Flex>

          <Typography.Paragraph
            style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
          >
            {c.text ?? fmtNone()}
          </Typography.Paragraph>

          {(c.reply || c.dm) && (
            <Flex
              vertical
              gap={4}
              style={{
                background: colorFillTertiary,
                border: `1px solid ${colorBorderSecondary}`,
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              {c.reply && (
                <Typography.Text style={{ fontSize: 13 }}>
                  <span style={{ color: colorTextSecondary }}>
                    {c.reply.byAgent && <RobotOutlined />}{" "}
                    {t("igComments.repliedBy", "Replied publicly by {{name}}", {
                      name: by(c.reply.byAgent, c.reply.by),
                    })}
                    {c.reply.at ? ` · ${fmtDateTime(c.reply.at)}` : ""}
                    {!c.reply.posted
                      ? ` · ${t("chat.queuedLabel", "Queued")}`
                      : ""}
                    {": "}
                  </span>
                  {c.reply.text}
                </Typography.Text>
              )}
              {c.dm && (
                <Typography.Text style={{ fontSize: 13 }}>
                  <span style={{ color: colorTextSecondary }}>
                    {c.dm.byAgent && <RobotOutlined />}{" "}
                    {t("igComments.dmBy", "DM sent by {{name}}", {
                      name: by(c.dm.byAgent, c.dm.by),
                    })}
                    {c.dm.at ? ` · ${fmtDateTime(c.dm.at)}` : ""}
                    {": "}
                  </span>
                  {c.dm.text}
                </Typography.Text>
              )}
            </Flex>
          )}

          <Flex gap={6} wrap>
            <Button
              size="small"
              icon={<MessageOutlined />}
              type={composer === "reply" ? "primary" : "default"}
              onClick={() => open("reply")}
            >
              {t("igComments.replyPublicly", "Reply publicly")}
            </Button>
            <Tooltip
              title={
                c.canPrivateReply
                  ? ""
                  : t(
                      "igComments.dmNotAllowed",
                      "Instagram allows one DM per comment, within 7 days",
                    )
              }
            >
              <Button
                size="small"
                icon={<SendOutlined />}
                type={composer === "dm" ? "primary" : "default"}
                disabled={!c.canPrivateReply}
                onClick={() => open("dm")}
              >
                {t("igComments.sendDm", "Send DM")}
              </Button>
            </Tooltip>
            <Button
              size="small"
              icon={hidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              loading={busy === "hide"}
              onClick={() =>
                void run(
                  "hide",
                  () => hideComment(c.id, !hidden),
                  hidden
                    ? t("igComments.shown", "The comment is shown again.")
                    : t("igComments.hiddenDone", "The comment is hidden."),
                )
              }
            >
              {hidden
                ? t("igComments.unhide", "Unhide")
                : t("igComments.hide", "Hide")}
            </Button>
            <Tooltip
              title={
                hidden ? t("igComments.unhideFirst", "Unhide it first") : ""
              }
            >
              <Button
                size="small"
                icon={done ? <RollbackOutlined /> : <CheckOutlined />}
                loading={busy === "done"}
                disabled={hidden}
                onClick={() =>
                  void run(
                    "done",
                    () => markCommentDone(c.id, !done),
                    done
                      ? t("igComments.reopened", "The comment is open again.")
                      : t("igComments.markedDone", "Marked as done."),
                  )
                }
              >
                {done
                  ? t("igComments.reopen", "Reopen")
                  : t("igComments.markDone", "Mark done")}
              </Button>
            </Tooltip>
          </Flex>

          {composer && (
            <Flex vertical gap={6}>
              <Input.TextArea
                // A fresh box per composer, focused as it opens.
                key={composer}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 6 }}
                status={tooLong ? "error" : undefined}
                aria-label={
                  composer === "reply"
                    ? t("igComments.replyBox", "Public reply")
                    : t("igComments.dmBox", "Private DM")
                }
                placeholder={
                  composer === "reply"
                    ? t(
                        "igComments.replyPlaceholder",
                        "Everyone can see this reply under the comment.",
                      )
                    : t(
                        "igComments.dmPlaceholder",
                        "Sent to {{who}} as a DM. Instagram allows only one.",
                        { who },
                      )
                }
              />
              <Flex justify="space-between" align="center" gap={8}>
                <Typography.Text
                  type={tooLong ? "danger" : "secondary"}
                  style={{ fontSize: 12 }}
                >
                  {t("igComments.bytes", "{{n}} / {{max}} bytes", {
                    n: bytes,
                    max: IG_TEXT_MAX_BYTES,
                  })}
                </Typography.Text>
                <Flex gap={6}>
                  <Button size="small" onClick={() => setComposer(null)}>
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SendOutlined />}
                    loading={busy === composer}
                    disabled={!text.trim() || tooLong}
                    onClick={send}
                  >
                    {composer === "reply"
                      ? t("igComments.postReply", "Post reply")
                      : t("igComments.sendDmNow", "Send DM")}
                  </Button>
                </Flex>
              </Flex>
            </Flex>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}

/** The post's thumbnail, linked to the post; an icon when there is none. */
function PostThumb({ comment: c }: { readonly comment: IgComment }) {
  const { t } = useTranslation();
  const {
    token: { colorFillSecondary, colorTextSecondary },
  } = theme.useToken();
  const [broken, setBroken] = useState(false);
  const size = 56;
  const picture =
    c.media.thumbnailUrl && !broken ? (
      <img
        src={c.media.thumbnailUrl}
        alt={t("igComments.postPicture", "Post")}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        style={{ objectFit: "cover", borderRadius: 6, display: "block" }}
      />
    ) : (
      <Flex
        align="center"
        justify="center"
        aria-label={t("igComments.postPicture", "Post")}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          background: colorFillSecondary,
          color: colorTextSecondary,
          fontSize: 22,
        }}
      >
        <InstagramOutlined />
      </Flex>
    );
  return (
    <div style={{ flexShrink: 0 }}>
      {c.media.permalink ? (
        <a href={c.media.permalink} target="_blank" rel="noopener noreferrer">
          {picture}
        </a>
      ) : (
        picture
      )}
    </div>
  );
}
