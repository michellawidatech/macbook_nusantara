/**
 * WhatsApp connection — the shop's number as a device linked to the POS
 * (owner decision 2026-10-22, docs/whatsapp-baileys.md). Owner-only: the
 * server answers 403 to anybody else, and BotSettings does not draw this card
 * for them, because a QR on screen IS the shop's number for the minute it is
 * shown.
 *
 * ONE session. *Link WhatsApp* is disabled while a session is connected or
 * connecting, and the gateway refuses it too (409); link attempts are
 * rationed (three an hour), and the card says how many are left. The warning
 * is permanent rather than a dismissable tip: the connection is unofficial,
 * and the habit it warns against — linking and unlinking to "fix" something —
 * is exactly the one that gets a number banned.
 *
 * While a QR is up (or the device is connecting) the card asks the server
 * every three seconds, which is how a scan on the phone turns into
 * "Connected" here without anybody pressing anything.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Image,
  Skeleton,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  getWhatsAppConnection,
  linkWhatsApp,
  logoutWhatsApp,
  type SessionEnd,
  type WhatsAppConnection as Connection,
} from "../../lib/whatsappApi.js";

/** How often the card asks while something is about to change. */
export const POLL_MS = 3_000;

export function WhatsAppConnection() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [conn, setConn] = useState<Connection | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"link" | "logout" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConn(await getWhatsAppConnection());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = conn?.gateway === "OK" ? conn.state : undefined;
  const changing = state === "WAITING_FOR_SCAN" || state === "CONNECTING";
  useEffect(() => {
    if (!changing) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [changing, refresh]);

  const link = async () => {
    setBusy("link");
    try {
      setConn(await linkWhatsApp());
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("waConn.linkFailed", "Could not start linking."),
      );
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  const confirmLogout = () =>
    modal.confirm({
      title: t("waConn.logoutTitle", "Disconnect WhatsApp?"),
      content: t(
        "waConn.logoutBody",
        "The bot stops answering on this number until somebody scans a new QR. Linking again counts towards the limit, and linking and unlinking often can get the number banned.",
      ),
      okText: t("waConn.logoutOk", "Disconnect"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy("logout");
        try {
          setConn(await logoutWhatsApp());
          message.success(t("waConn.loggedOut", "WhatsApp disconnected."));
        } catch (err) {
          message.error(
            err instanceof Error
              ? err.message
              : t("waConn.logoutFailed", "Could not disconnect."),
          );
        } finally {
          setBusy(null);
        }
      },
    });

  const stateTag = () => {
    switch (state) {
      case "CONNECTED":
        return <Tag color="green">{t("waConn.connected", "Connected")}</Tag>;
      case "WAITING_FOR_SCAN":
        return (
          <Tag color="gold">{t("waConn.waiting", "Waiting for a scan")}</Tag>
        );
      case "CONNECTING":
        return <Tag color="blue">{t("waConn.connecting", "Connecting")}</Tag>;
      case "DISCONNECTED":
        return <Tag>{t("waConn.disconnected", "Not connected")}</Tag>;
      default:
        return null;
    }
  };

  const ended = (reason: SessionEnd) => {
    switch (reason) {
      case "LOGGED_OUT":
        return t(
          "waConn.endLoggedOut",
          "The device was removed from the phone (Linked devices). Link it again to resume.",
        );
      case "QR_EXPIRED":
        return t("waConn.endQrExpired", "The QR code was not scanned in time.");
      case "REPLACED":
        return t(
          "waConn.endReplaced",
          "This session was opened somewhere else. Make sure no other computer runs it, then link again.",
        );
      case "FORBIDDEN":
        return t(
          "waConn.endForbidden",
          "WhatsApp refused this number. Check the phone before trying again.",
        );
    }
  };

  const warning = (
    <Alert
      type="warning"
      showIcon
      title={t(
        "waConn.warnTitle",
        "Unofficial connection — WhatsApp can ban the number",
      )}
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          <li>
            {t(
              "waConn.warnRepeat",
              "Link once and leave it. Do not link and unlink repeatedly.",
            )}
          </li>
          <li>
            {t(
              "waConn.warnDedicated",
              "Prefer a dedicated number for the shop, not anybody's personal one.",
            )}
          </li>
          <li>
            {t(
              "waConn.warnOnline",
              "Keep the phone switched on and online: WhatsApp unlinks a device whose phone has been away for about 14 days.",
            )}
          </li>
        </ul>
      }
    />
  );

  const body = () => {
    if (failed) {
      return (
        <Typography.Text type="secondary">
          {t("waConn.loadFailed", "Could not read the connection.")}
        </Typography.Text>
      );
    }
    if (conn === null) return <Skeleton active paragraph={{ rows: 2 }} />;
    if (conn.gateway === "NOT_CONFIGURED") {
      return (
        <Typography.Text type="secondary">
          {t(
            "waConn.notConfigured",
            "This server sends WhatsApp through the Cloud API; there is no device to link.",
          )}
        </Typography.Text>
      );
    }
    if (conn.gateway === "UNREACHABLE") {
      return (
        <Alert
          type="error"
          showIcon
          title={t(
            "waConn.gatewayDown",
            "The WhatsApp gateway is not running on the server.",
          )}
          action={
            <Button size="small" onClick={() => void refresh()}>
              {t("waConn.checkAgain", "Check again")}
            </Button>
          }
        />
      );
    }

    const limit = conn.limit;
    const linked = state === "CONNECTED" || state === "CONNECTING";
    return (
      <Flex vertical gap={12}>
        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: "state",
              label: t("waConn.status", "Status"),
              children: stateTag(),
            },
            {
              key: "number",
              label: t("waConn.number", "Linked number"),
              children: conn.number ?? fmtNone(),
            },
            {
              key: "since",
              label: t("waConn.since", "Connected since"),
              children: conn.since ? fmtDateTime(conn.since) : fmtNone(),
            },
          ]}
        />
        {state === "DISCONNECTED" && conn.lastError && (
          <Alert type="info" showIcon title={ended(conn.lastError)} />
        )}
        {state === "WAITING_FOR_SCAN" && conn.qr && (
          <Flex vertical align="center" gap={8}>
            <Image
              src={conn.qr}
              alt={t("waConn.qrAlt", "QR code to link WhatsApp")}
              width={240}
              preview={false}
            />
            <Typography.Text type="secondary" style={{ textAlign: "center" }}>
              {t(
                "waConn.scanHow",
                "On the shop's phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.",
              )}
            </Typography.Text>
          </Flex>
        )}
        <Flex gap={8} wrap align="center">
          <Button
            type="primary"
            disabled={linked || state === "WAITING_FOR_SCAN"}
            loading={busy === "link"}
            onClick={() => void link()}
          >
            {t("waConn.link", "Link WhatsApp")}
          </Button>
          <Button
            danger
            disabled={state === "DISCONNECTED"}
            loading={busy === "logout"}
            onClick={confirmLogout}
          >
            {t("waConn.logout", "Disconnect")}
          </Button>
          {limit && (
            <Typography.Text type="secondary">
              {t(
                "waConn.attemptsLeft",
                "{{remaining}} of {{max}} link attempts left this hour",
                { remaining: limit.remaining, max: limit.max },
              )}
            </Typography.Text>
          )}
        </Flex>
      </Flex>
    );
  };

  return (
    <Card title={t("waConn.title", "WhatsApp connection")}>
      <Flex vertical gap={12}>
        {warning}
        {body()}
      </Flex>
    </Card>
  );
}
