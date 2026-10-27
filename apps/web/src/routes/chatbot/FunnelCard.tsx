/**
 * The funnel at the top of the Evaluation tab (owner, 2026-10-27: "convert
 * the casual chatter to a lead and even customer"). Five counts for the last
 * 7 and 30 days, each with its share of the chats beside it — the question
 * is where people stop, so every stage reads against the first.
 *
 * Counts only, for any member of staff: nothing here is money, which is what
 * keeps it out of Financial & Report's per-person lock.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Card, Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { getFunnel, type FunnelWindow } from "../../lib/chatApi.js";
import { COLUMN } from "../../theme/tokens";

type Stage = "chats" | "leads" | "visits" | "closing" | "sales";
const STAGES: readonly Stage[] = [
  "chats",
  "leads",
  "visits",
  "closing",
  "sales",
];

export function FunnelCard() {
  const { t } = useTranslation();
  const [windows, setWindows] = useState<FunnelWindow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getFunnel()
      .then((r) => live && setWindows(r.windows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const stageLabel = (s: Stage): ReactNode => {
    const [label, hint] = ((): [string, string] => {
      switch (s) {
        case "chats":
          return [
            t("chatFunnel.chats", "Chats"),
            t(
              "chatFunnel.chatsHint",
              "Customers who wrote in. Tester numbers and cleared chats are left out.",
            ),
          ];
        case "leads":
          return [
            t("chatFunnel.leads", "Leads"),
            t(
              "chatFunnel.leadsHint",
              "Chats the bot judged as serious buyers (🔥).",
            ),
          ];
        case "visits":
          return [
            t("chatFunnel.visits", "Visits booked"),
            t(
              "chatFunnel.visitsHint",
              "Customers who booked a time to come to the shop.",
            ),
          ];
        case "closing":
          return [
            t("chatFunnel.closing", "Ready to buy"),
            t(
              "chatFunnel.closingHint",
              "Customers who said they want to buy, or asked how to pay, about a DP or for a better price — handed to staff to close the sale.",
            ),
          ];
        default:
          return [
            t("chatFunnel.sales", "Sales"),
            t(
              "chatFunnel.salesHint",
              "Bought from this number within 30 days of their first message.",
            ),
          ];
      }
    })();
    return (
      <Tooltip title={hint}>
        <span
          style={{ borderBottom: "1px dotted currentColor", cursor: "help" }}
        >
          {label}
        </span>
      </Tooltip>
    );
  };

  const cell = (w: FunnelWindow | undefined, s: Stage) => {
    if (!w) return 0;
    const n = w[s];
    if (s === "chats" || w.chats === 0) return n;
    return (
      <span>
        {n}{" "}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          ({Math.round((n / w.chats) * 100)}%)
        </Typography.Text>
      </span>
    );
  };

  const week = windows?.find((w) => w.days === 7);
  const month = windows?.find((w) => w.days === 30);

  return (
    <Card size="small" title={t("chatFunnel.title", "Funnel")}>
      {failed ? (
        <Typography.Text type="secondary">
          {t("chatFunnel.loadFailed", "Could not load the funnel.")}
        </Typography.Text>
      ) : (
        <Table
          size="small"
          rowKey="stage"
          pagination={false}
          loading={windows === null}
          dataSource={STAGES.map((stage) => ({ stage }))}
          columns={[
            {
              key: "stage",
              title: t("chatFunnel.stage", "Stage"),
              render: (_, r) => stageLabel(r.stage),
            },
            {
              key: "week",
              title: t("chatFunnel.last7", "Last 7 days"),
              width: COLUMN.money,
              align: "right",
              render: (_, r) => cell(week, r.stage),
            },
            {
              key: "month",
              title: t("chatFunnel.last30", "Last 30 days"),
              width: COLUMN.money,
              align: "right",
              render: (_, r) => cell(month, r.stage),
            },
          ]}
        />
      )}
    </Card>
  );
}
