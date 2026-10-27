/**
 * "Handed over (last 7 days)" on the Evaluation tab (owner, 2026-10-27: *"I
 * feel like it escalates too much, it is not smart enough to make the
 * decision"*). How often the bot gave a chat to a person, by topic and by what
 * made it — the message itself, a draft the checks refused, the model's own
 * choice — and, a click away, the newest few messages behind each.
 */
import { useEffect, useState } from "react";
import { Card, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { TFunction } from "../../i18n/translate.js";
import { getHandovers, type HandoverReason } from "../../lib/chatApi.js";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import { handoffTopicLabel } from "../../lib/handoffTopics.js";
import { COLUMN } from "../../theme/tokens";

/**
 * What made the bot hand over, in words. Literal `t()` calls in a switch:
 * test/i18n.test.ts finds copy by reading the source.
 */
export function handoverReasonLabel(t: TFunction, reason: string): string {
  switch (reason) {
    case "bot":
      return t("chatHandovers.reasonBot", "The bot chose to");
    case "route":
      return t("chatHandovers.reasonRoute", "The message itself (a rule)");
    case "AMOUNT_NOT_IN_SOURCE":
      return t(
        "chatHandovers.reasonAmount",
        "Draft quoted a price it could not back",
      );
    case "AVAILABILITY_NOT_IN_SOURCE":
      return t(
        "chatHandovers.reasonStock",
        "Draft claimed stock it could not back",
      );
    case "DISCOUNT_OFFERED":
      return t("chatHandovers.reasonDiscount", "Draft offered a discount");
    case "UNKNOWN_SOURCE":
    case "NO_SOURCE":
      return t("chatHandovers.reasonSource", "Draft cited no real source");
    case "TOO_LONG":
    case "EMPTY":
      return t("chatHandovers.reasonLength", "Draft too long or empty");
    case "no_terminal_tool":
      return t(
        "chatHandovers.reasonUnfinished",
        "The bot never finished its answer",
      );
    case "no_reply":
      return t(
        "chatHandovers.reasonError",
        "The bot failed (see the worker log)",
      );
    case "window_closed":
      return t("chatHandovers.reasonWindow", "The 24-hour window had closed");
    case "nothing_to_read":
      return t("chatHandovers.reasonNoText", "A message with no text");
    default:
      return reason;
  }
}

export function HandoversCard() {
  const { t } = useTranslation();
  const [data, setData] = useState<{
    total: number;
    reasons: HandoverReason[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getHandovers()
      .then((r) => live && setData(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card
      size="small"
      title={t("chatHandovers.title", "Handed over (last 7 days)")}
      extra={
        data ? (
          <Typography.Text type="secondary">
            {t("chatHandovers.total", "{{n}} in total", { n: data.total })}
          </Typography.Text>
        ) : null
      }
    >
      {failed ? (
        <Typography.Text type="secondary">
          {t("chatHandovers.loadFailed", "Could not load the hand-overs.")}
        </Typography.Text>
      ) : (
        <Table<HandoverReason>
          size="small"
          rowKey={(r) => `${r.topic}:${r.reason}`}
          pagination={false}
          loading={data === null}
          dataSource={data?.reasons ?? []}
          locale={{
            emptyText: t(
              "chatHandovers.none",
              "Nothing was handed over in the last 7 days.",
            ),
          }}
          expandable={{
            expandRowByClick: true,
            expandedRowRender: (r) => (
              <Table
                size="small"
                rowKey={(e) => `${e.phone}:${e.at}`}
                pagination={false}
                dataSource={r.examples}
                columns={[
                  {
                    key: "at",
                    title: t("chatHandovers.at", "When"),
                    width: COLUMN.date,
                    render: (_, e) => fmtDateTime(e.at),
                  },
                  {
                    key: "phone",
                    title: t("chatHandovers.phone", "Number"),
                    width: COLUMN.code,
                    render: (_, e) => e.phone,
                  },
                  {
                    key: "text",
                    title: t("chatHandovers.message", "Customer wrote"),
                    render: (_, e) => e.text ?? fmtNone(),
                  },
                  {
                    key: "summary",
                    title: t("chatHandovers.summary", "Task left"),
                    render: (_, e) => e.summary ?? fmtNone(),
                  },
                ]}
              />
            ),
          }}
          columns={[
            {
              key: "topic",
              title: t("chatHandovers.topic", "Topic"),
              render: (_, r) => handoffTopicLabel(t, r.topic),
            },
            {
              key: "reason",
              title: t("chatHandovers.reason", "Why"),
              render: (_, r) => handoverReasonLabel(t, r.reason),
            },
            {
              key: "count",
              title: t("chatHandovers.count", "Times"),
              width: COLUMN.qty,
              align: "right",
              render: (_, r) => r.count,
            },
          ]}
        />
      )}
    </Card>
  );
}
