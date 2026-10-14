/**
 * The simulator on Settings (owner ask 2026-10-15): talk to the bot as a
 * customer would, and see what each answer cost and which agents ran.
 *
 * A dry run — `POST /api/chat/simulate` reads the POS and books nothing,
 * sends nothing, writes nothing — so the whole conversation so far goes with
 * every message and lives only in this component. The refresh icon starts
 * over. Under each bot bubble: the AI cost, how long it took, and the steps
 * (agent · model · tool · ms) folded shut.
 */
import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Flex,
  Input,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  DownOutlined,
  RightOutlined,
  RobotOutlined,
  SendOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "../../lib/api.js";
import {
  simulate,
  type AgentTurn,
  type SimulationResult,
} from "../../lib/chatApi.js";
import { handoffTopicLabel } from "../../lib/handoffTopics.js";
import { agentLabel } from "./labels.js";

type Line =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; result: SimulationResult }
  | { role: "error"; text: string };

/** USD from millionths of a dollar, four places: "$0.0042". */
export const fmtCost = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;

const fmtLatency = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;

function BotMeta({ result }: { result: SimulationResult }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Flex vertical gap={2} style={{ marginTop: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("chatSim.cost", "AI cost: {{cost}}", {
          cost: fmtCost(result.costMicros),
        })}
        {" · "}
        {fmtLatency(result.latencyMs)}
      </Typography.Text>
      {result.steps.length > 0 && (
        <>
          <Button
            type="link"
            size="small"
            style={{
              padding: 0,
              height: "auto",
              alignSelf: "flex-start",
              fontSize: 12,
            }}
            icon={open ? <DownOutlined /> : <RightOutlined />}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {t("chatSim.steps", "{{n}} steps", { n: result.steps.length })}
          </Button>
          {open && (
            <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 12 }}>
              {result.steps.map((s, i) => (
                <li key={i}>
                  <Typography.Text
                    type={s.ok ? "secondary" : "danger"}
                    style={{ fontSize: 12 }}
                  >
                    {[agentLabel(t, s.agent), s.model, s.tool, `${s.ms} ms`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography.Text>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Flex>
  );
}

export function Simulator() {
  const { t } = useTranslation();
  const {
    token: {
      colorPrimary,
      colorBgContainer,
      colorFillTertiary,
      colorBorderSecondary,
      colorTextLightSolid,
      colorWarningBg,
      colorWarningBorder,
    },
  } = theme.useToken();
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Bumped by "start over", so an answer to the old conversation is dropped. */
  const generation = useRef(0);

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const turns: AgentTurn[] = [
      ...lines.flatMap((l): AgentTurn[] =>
        l.role === "error" ? [] : [{ role: l.role, text: l.text }],
      ),
      { role: "user", text },
    ];
    const gen = generation.current;
    setLines((ls) => [...ls, { role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      const result = await simulate(turns);
      if (gen !== generation.current) return;
      setLines((ls) => [
        ...ls,
        { role: "assistant", text: result.reply, result },
      ]);
    } catch (err) {
      if (gen !== generation.current) return;
      const why =
        err instanceof ApiRequestError && err.status === 503
          ? t(
              "chatSim.noCredential",
              "The bot has no Claude credential on the server, so it cannot answer.",
            )
          : err instanceof Error
            ? err.message
            : t("chatSim.failed", "The simulator could not answer.");
      setLines((ls) => [...ls, { role: "error", text: why }]);
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  };

  const restart = () => {
    generation.current += 1;
    setLines([]);
    setBusy(false);
  };

  return (
    <section
      aria-label={t("chatSim.title", "Simulator")}
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${colorBorderSecondary}`,
        borderRadius: 16,
        overflow: "hidden",
        background: colorBgContainer,
        height: 600,
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={10}>
          <Avatar icon={<RobotOutlined />} />
          <Typography.Text strong style={{ fontSize: 16 }}>
            {t("chatSim.botName", "Nusantara bot")}
          </Typography.Text>
        </Flex>
        <Tooltip title={t("chatSim.restart", "Start over")}>
          <Button
            type="text"
            icon={<SyncOutlined />}
            aria-label={t("chatSim.restart", "Start over")}
            onClick={restart}
          />
        </Tooltip>
      </Flex>

      <Flex
        ref={scrollRef}
        vertical
        gap={12}
        role="log"
        aria-label={t("chatSim.conversation", "Simulated conversation")}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 16,
          background: colorFillTertiary,
        }}
      >
        {lines.length === 0 && (
          <Typography.Text type="secondary" style={{ textAlign: "center" }}>
            {t(
              "chatSim.empty",
              "Write as a customer would. Nothing is sent, booked or saved.",
            )}
          </Typography.Text>
        )}
        {lines.map((l, i) =>
          l.role === "user" ? (
            <Flex key={i} justify="flex-end">
              <div
                style={{
                  maxWidth: "78%",
                  padding: "8px 14px",
                  borderRadius: 18,
                  background: colorPrimary,
                  color: colorTextLightSolid,
                  whiteSpace: "pre-wrap",
                }}
              >
                {l.text}
              </div>
            </Flex>
          ) : l.role === "error" ? (
            <Typography.Text key={i} type="danger" role="alert">
              {l.text}
            </Typography.Text>
          ) : (
            <Flex key={i} justify="flex-start">
              <div
                data-testid="sim-bot-bubble"
                style={{
                  maxWidth: "78%",
                  padding: "10px 14px",
                  borderRadius: 18,
                  background: colorBgContainer,
                  border: `1px solid ${colorBorderSecondary}`,
                }}
              >
                <div style={{ whiteSpace: "pre-wrap" }}>{l.text}</div>
                {l.result.handoff && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      background: colorWarningBg,
                      border: `1px solid ${colorWarningBorder}`,
                    }}
                  >
                    <Tag color="orange" style={{ marginInlineEnd: 6 }}>
                      {t("chatSim.handoff", "Hands over · {{topic}}", {
                        topic: handoffTopicLabel(t, l.result.handoff.topic),
                      })}
                    </Tag>
                    {l.result.handoff.summary}
                  </div>
                )}
                {l.result.photos.length > 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", marginTop: 6, fontSize: 12 }}
                  >
                    {t("chatSim.photos", "Would attach photos: {{ids}}", {
                      ids: l.result.photos.join(", "),
                    })}
                  </Typography.Text>
                )}
                <BotMeta result={l.result} />
              </div>
            </Flex>
          ),
        )}
        {busy && (
          <Typography.Text type="secondary">
            {t("chatSim.thinking", "The bot is writing…")}
          </Typography.Text>
        )}
      </Flex>

      <Flex
        align="flex-end"
        gap={8}
        style={{
          padding: "10px 12px",
          borderTop: `1px solid ${colorBorderSecondary}`,
        }}
      >
        <Input.TextArea
          variant="borderless"
          autoSize={{ minRows: 1, maxRows: 4 }}
          aria-label={t("chatSim.message", "Your message")}
          placeholder={t("chatSim.placeholder", "Type your message…")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (e.shiftKey) return;
            e.preventDefault();
            void send();
          }}
        />
        <Button
          type="text"
          icon={<SendOutlined style={{ fontSize: 20 }} />}
          aria-label={t("chatSim.send", "Send")}
          disabled={!draft.trim() || busy}
          onClick={() => void send()}
        />
      </Flex>
    </section>
  );
}
