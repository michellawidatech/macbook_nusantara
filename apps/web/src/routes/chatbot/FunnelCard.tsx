/**
 * The funnel at the top of the Evaluation tab (owner, 2026-10-27: "convert
 * the casual chatter to a lead and even customer"). Five counts for the last
 * 7 and 30 days, each with its share of the chats beside it — the question
 * is where people stop, so every stage reads against the first.
 *
 * Counts only, for any member of staff: nothing here is money, which is what
 * keeps it out of Financial & Report's per-person lock. A number opens the
 * accounts behind it, each with *Open chat* (2026-10-28), and tester numbers
 * count (owner, same day).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Modal, Table, Tooltip, Typography } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  getFunnel,
  getFunnelPeople,
  type FunnelPerson,
  type FunnelStageKey,
  type FunnelWindow,
} from "../../lib/chatApi.js";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import { COLUMN } from "../../theme/tokens";

type Stage = FunnelStageKey;
const STAGES: readonly Stage[] = [
  "chats",
  "leads",
  "visits",
  "closing",
  "sales",
];

export interface FunnelCardProps {
  /**
   * Open this thread in the Chat tab (owner, 2026-10-28: *"we can click it to
   * see which accounts and they can chat it"*).
   */
  readonly onOpenChat: (phone: string) => void;
}

export function FunnelCard({ onOpenChat }: FunnelCardProps) {
  const { t } = useTranslation();
  const [windows, setWindows] = useState<FunnelWindow[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Whose accounts are listed: a stage and a window, or nothing. */
  const [open, setOpen] = useState<{
    readonly stage: Stage;
    readonly days: number;
  } | null>(null);
  const [people, setPeople] = useState<FunnelPerson[] | null>(null);
  const [peopleFailed, setPeopleFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPeople(null);
    setPeopleFailed(false);
    getFunnelPeople(open.stage, open.days)
      .then((r) => live && setPeople(r.people))
      .catch(() => live && setPeopleFailed(true));
    return () => {
      live = false;
    };
  }, [open?.stage, open?.days]);

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
              "Customers who wrote in, tester numbers included. Cleared chats are left out.",
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

  /** A number is a button that lists the accounts behind it. */
  const cell = (w: FunnelWindow | undefined, s: Stage) => {
    if (!w) return 0;
    const n = w[s];
    const share =
      s === "chats" || w.chats === 0 ? null : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {" "}
          ({Math.round((n / w.chats) * 100)}%)
        </Typography.Text>
      );
    if (n === 0)
      return (
        <span>
          {n}
          {share}
        </span>
      );
    return (
      <span>
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0, height: "auto" }}
          aria-label={t("chatFunnel.showWho", "Show who — {{n}}", { n })}
          onClick={() => setOpen({ stage: s, days: w.days })}
        >
          {n}
        </Button>
        {share}
      </span>
    );
  };

  const week = windows?.find((w) => w.days === 7);
  const month = windows?.find((w) => w.days === 30);

  const stageName: Record<Stage, string> = {
    chats: t("chatFunnel.chats", "Chats"),
    leads: t("chatFunnel.leads", "Leads"),
    visits: t("chatFunnel.visits", "Visits booked"),
    closing: t("chatFunnel.closing", "Ready to buy"),
    sales: t("chatFunnel.sales", "Sales"),
  };

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
      <Modal
        open={open !== null}
        onCancel={() => setOpen(null)}
        footer={null}
        width={760}
        title={
          open
            ? t("chatFunnel.whoTitle", "{{stage}} — last {{days}} days", {
                stage: stageName[open.stage],
                days: open.days,
              })
            : ""
        }
        destroyOnHidden
      >
        {peopleFailed ? (
          <Typography.Text type="secondary">
            {t("chatFunnel.whoFailed", "Could not load the list.")}
          </Typography.Text>
        ) : (
          <Table<FunnelPerson>
            size="small"
            rowKey="phone"
            loading={people === null}
            dataSource={people ?? []}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            columns={[
              {
                key: "who",
                title: t("chatFunnel.who", "Customer"),
                render: (_, p) => (
                  <span>
                    <Typography.Text strong>
                      {p.name || p.phone}
                    </Typography.Text>
                    {p.name ? (
                      <>
                        <br />
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          {p.phone}
                        </Typography.Text>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: "at",
                title: t("chatFunnel.when", "When"),
                width: COLUMN.date + 40,
                render: (_, p) => fmtDateTime(p.at),
              },
              {
                key: "last",
                title: t("chatFunnel.lastMessage", "Last message"),
                ellipsis: true,
                render: (_, p) => p.lastText || fmtNone(),
              },
              {
                key: "open",
                title: "",
                width: 132,
                align: "right",
                render: (_, p) => (
                  <Button
                    size="small"
                    type="primary"
                    icon={<MessageOutlined />}
                    onClick={() => {
                      setOpen(null);
                      onOpenChat(p.phone);
                    }}
                  >
                    {t("chatFunnel.openChat", "Open chat")}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </Card>
  );
}
