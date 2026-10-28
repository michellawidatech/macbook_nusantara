/**
 * Which model the bot runs on, and what it did and cost (owner, 2026-10-28:
 * "the model used, the usage"). The model is the owner's to change and
 * applies to the next message; usage is for everybody.
 */
import { useEffect, useState } from "react";
import { App, Card, Flex, Select, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  getChatModel,
  getChatUsage,
  setChatModel,
  type ChatModelState,
  type ChatUsageWindow,
} from "../../lib/chatApi.js";

const num = (n: number) => n.toLocaleString("id-ID");

export function ModelUsageCard({ isOwner }: { readonly isOwner: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [model, setModel] = useState<ChatModelState | null>(null);
  const [usage, setUsage] = useState<ChatUsageWindow[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getChatModel()
      .then(setModel)
      .catch(() => setModel(null));
    getChatUsage()
      .then((r) => setUsage(r.windows))
      .catch(() => setUsage([]));
  }, []);

  const change = async (id: string) => {
    setSaving(true);
    try {
      setModel(await setChatModel(id));
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatModel.saveFailed", "Could not change the model."),
      );
    } finally {
      setSaving(false);
    }
  };

  const current = model?.model ?? model?.envModel ?? null;
  const chosen = model?.models.find((m) => m.id === current);

  return (
    <Card title={t("chatModel.title", "Model & usage")}>
      <Flex vertical gap={12}>
        <Flex vertical gap={4}>
          <Typography.Text strong>
            {t("chatModel.model", "Model")}
          </Typography.Text>
          <Select
            style={{ maxWidth: 320 }}
            loading={model === null}
            disabled={!isOwner || saving}
            value={current ?? undefined}
            placeholder={t("chatModel.default", "The server's default")}
            aria-label={t("chatModel.model", "Model")}
            onChange={(v: string) => void change(v)}
            options={(model?.models ?? []).map((m) => ({
              value: m.id,
              label: m.worksWithSetupToken
                ? m.label
                : t("chatModel.needsKey", "{{label}} (needs an API key)", {
                    label: m.label,
                  }),
            }))}
          />
          {chosen && !chosen.worksWithSetupToken && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              {t(
                "chatModel.setupTokenWarning",
                "A setup-token login cannot run this model. If replies stop coming from the AI, choose Haiku 4.5.",
              )}
            </Typography.Text>
          )}
        </Flex>
        <Table<ChatUsageWindow>
          size="small"
          rowKey="days"
          loading={usage === null}
          dataSource={usage ?? []}
          pagination={false}
          columns={[
            {
              key: "days",
              title: t("chatUsage.period", "Period"),
              render: (_, w) =>
                t("chatUsage.lastDays", "Last {{days}} days", { days: w.days }),
            },
            {
              key: "replies",
              title: t("chatUsage.replies", "Replies"),
              align: "right",
              render: (_, w) => num(w.replies),
            },
            {
              key: "ai",
              title: t("chatUsage.byAi", "By AI"),
              align: "right",
              render: (_, w) => num(w.byAi),
            },
            {
              key: "templates",
              title: t("chatUsage.byTemplates", "Templates"),
              align: "right",
              render: (_, w) => num(w.byTemplates),
            },
            {
              key: "handovers",
              title: t("chatUsage.handovers", "To staff"),
              align: "right",
              render: (_, w) => num(w.handovers),
            },
            {
              key: "tokens",
              title: t("chatUsage.tokens", "Tokens in / out"),
              align: "right",
              render: (_, w) =>
                `${num(w.inputTokens + w.cachedTokens)} / ${num(w.outputTokens)}`,
            },
            {
              key: "cost",
              title: t("chatUsage.cost", "AI cost"),
              align: "right",
              render: (_, w) => `US$ ${w.costUsd.toFixed(2)}`,
            },
          ]}
        />
      </Flex>
    </Card>
  );
}
