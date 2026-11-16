/**
 * Instagram — the owner's card on Chatbot → Settings (2026-11-16,
 * docs/superpowers/specs/2026-11-16-instagram-design.md). Owner-only: the
 * connection route answers 403 to anybody else and BotSettings does not draw
 * this card for them, as with the WhatsApp connection.
 *
 * Two halves:
 *
 *  - **Connection**, read-only: the account the worker last saw, when, its
 *    last error, the token's expiry (warned under ten days, or when nobody
 *    knows it), the newest delivery from Meta, and whether Meta approved the
 *    Human Agent 7-day reply. The API never holds the token; the worker
 *    refreshes it weekly and writes what it found.
 *  - **Comment auto-reply**: the switch and its two templates — the public
 *    reply under the comment and the private DM sent with it. It answers a
 *    person's first top-level comment on a post, once. Save is grey until
 *    something changed, and refuses a switched-on auto-reply with no public
 *    reply (the server does too).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Input,
  Skeleton,
  Switch,
  Tag,
  Typography,
} from "antd";
import { InstagramOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { fmtDate, fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  getInstagramConnection,
  getInstagramSettings,
  IG_TEXT_MAX_BYTES,
  saveInstagramSettings,
  utf8Bytes,
  type InstagramConnection,
  type InstagramSettings,
} from "../../lib/instagramApi.js";
import { useUnchanged } from "../../hooks/useUnchanged.js";

/** Warn when the token has fewer days than this left. */
export const TOKEN_WARN_DAYS = 10;
/** The server's limit on the public reply template. */
export const REPLY_TEMPLATE_MAX = 300;

const DAY_MS = 86_400_000;

type Draft = Pick<
  InstagramSettings,
  "autoReply" | "replyTemplate" | "dmTemplate"
>;

const draftOf = (s: InstagramSettings): Draft => ({
  autoReply: s.autoReply,
  replyTemplate: s.replyTemplate,
  dmTemplate: s.dmTemplate,
});

export function InstagramCard({
  now = () => new Date(),
}: {
  now?: () => Date;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [conn, setConn] = useState<InstagramConnection | null>(null);
  const [connFailed, setConnFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [settingsFailed, setSettingsFailed] = useState<string | null>(null);
  /** Bumped on load and on save: what "unchanged" compares against. */
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.allSettled([
      getInstagramConnection(),
      getInstagramSettings(),
    ]);
    if (c.status === "fulfilled") {
      setConn(c.value);
      setConnFailed(null);
    } else {
      setConnFailed(
        c.reason instanceof Error
          ? c.reason.message
          : t("igCard.loadFailed", "Could not load."),
      );
    }
    if (s.status === "fulfilled") {
      setSaved(draftOf(s.value));
      setDraft(draftOf(s.value));
      setVersion((v) => v + 1);
      setSettingsFailed(null);
    } else {
      setSettingsFailed(
        s.reason instanceof Error
          ? s.reason.message
          : t("igCard.loadFailed", "Could not load."),
      );
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const unchanged = useUnchanged(saved, draft, version);
  const replyMissing = Boolean(draft?.autoReply && !draft.replyTemplate.trim());
  const dmBytes = utf8Bytes(draft?.dmTemplate ?? "");
  const dmTooLong = dmBytes > IG_TEXT_MAX_BYTES;

  const save = async () => {
    if (!draft || replyMissing || dmTooLong) return;
    setSaving(true);
    try {
      const next = await saveInstagramSettings({
        autoReply: draft.autoReply,
        replyTemplate: draft.replyTemplate.trim(),
        dmTemplate: draft.dmTemplate.trim(),
      });
      setSaved(draftOf(next));
      setDraft(draftOf(next));
      setVersion((v) => v + 1);
      message.success(t("igCard.saved", "Instagram settings saved."));
    } catch (err) {
      message.error(
        err instanceof Error && err.message
          ? err.message
          : t("igCard.saveFailed", "Could not save the settings."),
      );
    } finally {
      setSaving(false);
    }
  };

  const account = conn?.account ?? null;
  const expiresAt = account?.tokenExpiresAt ?? null;
  const daysLeft =
    expiresAt === null
      ? null
      : Math.floor((new Date(expiresAt).getTime() - now().getTime()) / DAY_MS);

  const tokenCell = () => {
    if (expiresAt === null || daysLeft === null)
      return (
        <Tag color="gold" data-testid="ig-token-warning">
          {t("igCard.tokenUnknown", "Expiry not known yet")}
        </Tag>
      );
    if (daysLeft < 0)
      return (
        <Flex gap={6} align="center" wrap>
          <span>{fmtDate(expiresAt)}</span>
          <Tag color="red" data-testid="ig-token-warning">
            {t("igCard.tokenExpired", "Expired")}
          </Tag>
        </Flex>
      );
    return (
      <Flex gap={6} align="center" wrap>
        <span>{fmtDate(expiresAt)}</span>
        {daysLeft < TOKEN_WARN_DAYS && (
          <Tag color="gold" data-testid="ig-token-warning">
            {t("igCard.tokenSoon", "{{days}} day(s) left", { days: daysLeft })}
          </Tag>
        )}
      </Flex>
    );
  };

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <InstagramOutlined />
          {t("igCard.title", "Instagram")}
        </Flex>
      }
    >
      <Flex vertical gap={16}>
        {connFailed && <Alert type="error" showIcon title={connFailed} />}
        {!conn && !connFailed ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : conn ? (
          <>
            <Descriptions
              size="small"
              column={{ xs: 1, md: 2 }}
              items={[
                {
                  key: "status",
                  label: t("igCard.status", "Status"),
                  children: conn.connected ? (
                    <Tag color="green">
                      {t("igCard.connected", "Connected")}
                    </Tag>
                  ) : (
                    <Tag>{t("igCard.notConnected", "Not connected")}</Tag>
                  ),
                },
                {
                  key: "account",
                  label: t("igCard.account", "Account"),
                  children: account?.username
                    ? `@${account.username}${account.name ? ` (${account.name})` : ""}`
                    : fmtNone(),
                },
                {
                  key: "type",
                  label: t("igCard.accountType", "Account type"),
                  children: account?.accountType ?? fmtNone(),
                },
                {
                  key: "checked",
                  label: t("igCard.checkedAt", "Last checked"),
                  children: account?.checkedAt
                    ? fmtDateTime(account.checkedAt)
                    : fmtNone(),
                },
                {
                  key: "token",
                  label: t("igCard.tokenExpires", "Token expires"),
                  children: tokenCell(),
                },
                {
                  key: "event",
                  label: t("igCard.lastEvent", "Last delivery from Meta"),
                  children: conn.lastEventAt
                    ? fmtDateTime(conn.lastEventAt)
                    : t("igCard.noEvent", "No delivery from Meta yet"),
                },
                {
                  key: "human",
                  label: t("igCard.humanAgent", "7-day reply (Human Agent)"),
                  children: conn.humanAgent ? (
                    <Tag color="green">
                      {t(
                        "igCard.humanAgentOn",
                        "On: a person may reply up to 7 days",
                      )}
                    </Tag>
                  ) : (
                    <Tag>
                      {t(
                        "igCard.humanAgentOff",
                        "Off: replies stop 24 hours after the customer's last message",
                      )}
                    </Tag>
                  ),
                },
                {
                  key: "senders",
                  label: t("igCard.senders", "People who wrote"),
                  children: conn.senders,
                },
              ]}
            />
            {account?.lastError && (
              <Alert
                type="error"
                showIcon
                title={t("igCard.lastError", "Last error: {{error}}", {
                  error: account.lastError,
                })}
              />
            )}
          </>
        ) : null}

        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("igCard.autoReplyTitle", "Comment auto-reply")}
        </Typography.Title>
        {settingsFailed && (
          <Alert type="error" showIcon title={settingsFailed} />
        )}
        {!draft && !settingsFailed ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : draft ? (
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">
              {t(
                "igCard.autoReplyHint",
                "Answers a person's first top-level comment on a post, once: a public reply under it and a DM.",
              )}
            </Typography.Text>
            <Flex align="center" gap={8}>
              <Switch
                checked={draft.autoReply}
                onChange={(v) => setDraft({ ...draft, autoReply: v })}
                aria-label={t("igCard.autoReply", "Auto-reply to comments")}
              />
              <Typography.Text>
                {t("igCard.autoReply", "Auto-reply to comments")}
              </Typography.Text>
            </Flex>
            <Flex vertical gap={4}>
              <Typography.Text strong>
                {t("igCard.replyTemplate", "Public reply")}
              </Typography.Text>
              <Input.TextArea
                value={draft.replyTemplate}
                onChange={(e) =>
                  setDraft({ ...draft, replyTemplate: e.target.value })
                }
                maxLength={REPLY_TEMPLATE_MAX}
                autoSize={{ minRows: 1, maxRows: 4 }}
                status={replyMissing ? "error" : undefined}
                aria-label={t("igCard.replyTemplate", "Public reply")}
              />
              {replyMissing && (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {t(
                    "igCard.replyRequired",
                    "Write the public reply, or switch auto-reply off.",
                  )}
                </Typography.Text>
              )}
            </Flex>
            <Flex vertical gap={4}>
              <Typography.Text strong>
                {t("igCard.dmTemplate", "Private DM")}
              </Typography.Text>
              <Input.TextArea
                value={draft.dmTemplate}
                onChange={(e) =>
                  setDraft({ ...draft, dmTemplate: e.target.value })
                }
                autoSize={{ minRows: 2, maxRows: 6 }}
                status={dmTooLong ? "error" : undefined}
                aria-label={t("igCard.dmTemplate", "Private DM")}
              />
              <Typography.Text
                type={dmTooLong ? "danger" : "secondary"}
                style={{ fontSize: 12 }}
              >
                {t("igComments.bytes", "{{n}} / {{max}} bytes", {
                  n: dmBytes,
                  max: IG_TEXT_MAX_BYTES,
                })}
              </Typography.Text>
            </Flex>
            <Flex justify="flex-end">
              <Button
                type="primary"
                loading={saving}
                disabled={unchanged || replyMissing || dmTooLong}
                onClick={() => void save()}
              >
                {t("common.save", "Save")}
              </Button>
            </Flex>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}
