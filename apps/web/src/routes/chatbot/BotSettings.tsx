/**
 * Settings — how the bot is put together (owner ask 2026-10-15).
 *
 * On top: the four "may answer" switches and the testers (moved here off the
 * Chat tab, where they were a bar above every conversation), which pipeline
 * answers — three agents (v2) or the single agent (v1) — and the lead
 * threshold. Below, the three agents with their persona prompts on the left,
 * and the simulator on the right to try a change out on.
 *
 * Every write here is the owner's: the server answers 403 to anybody else,
 * and the controls are drawn disabled for them rather than hidden, because
 * knowing how the bot is set up is what tells staff which chats will land
 * on their desk.
 */
import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Flex,
  InputNumber,
  Input,
  Modal,
  Row,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  getChatSettings,
  listAgents,
  resetAgentPrompt,
  saveAgentPrompt,
  setChatSettings,
  type AgentPersona,
  type ChatSettings,
} from "../../lib/chatApi.js";
import { useSession } from "../../lib/session.js";
import { BotSwitches } from "./BotSwitches.js";
import { Simulator } from "./Simulator.js";

function PersonaModal({
  agent,
  isOwner,
  onClose,
  onSaved,
}: {
  agent: AgentPersona;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (a: AgentPersona) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState(agent.prompt);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const run = async (kind: "save" | "reset") => {
    setBusy(kind);
    try {
      const { agent: next } =
        kind === "save"
          ? await saveAgentPrompt(agent.agent, prompt)
          : await resetAgentPrompt(agent.agent);
      setPrompt(next.prompt);
      onSaved(next);
      message.success(
        kind === "save"
          ? t("chatAgents.saved", "Saved. The bot uses it from its next reply.")
          : t("chatAgents.wasReset", "Back to the default persona."),
      );
      if (kind === "save") onClose();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatAgents.saveFailed", "Could not save the persona."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      width={760}
      onCancel={onClose}
      title={
        <Flex align="center" gap={8} wrap>
          <span>{agent.name}</span>
          <Tag color={agent.isDefault ? "default" : "blue"}>
            {agent.isDefault
              ? t("chatAgents.default", "Default")
              : t("chatAgents.edited", "Edited")}
          </Tag>
        </Flex>
      }
      footer={
        <Flex justify="space-between" gap={8} wrap>
          <Tooltip
            title={
              isOwner
                ? undefined
                : t("chatSwitch.ownerOnly", "Only the owner can change this.")
            }
          >
            <Button
              disabled={!isOwner || agent.isDefault}
              loading={busy === "reset"}
              onClick={() => void run("reset")}
            >
              {t("chatAgents.reset", "Reset to default")}
            </Button>
          </Tooltip>
          <Flex gap={8}>
            <Button onClick={onClose}>{t("chatAgents.close", "Close")}</Button>
            <Button
              type="primary"
              disabled={!isOwner || !prompt.trim() || prompt === agent.prompt}
              loading={busy === "save"}
              onClick={() => void run("save")}
            >
              {t("chatAgents.save", "Save")}
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap={8}>
        <Typography.Text type="secondary">
          {agent.task} · {agent.model}
        </Typography.Text>
        <Input.TextArea
          aria-label={t("chatAgents.prompt", "Persona prompt")}
          value={prompt}
          readOnly={!isOwner}
          onChange={(e) => setPrompt(e.target.value)}
          autoSize={{ minRows: 14, maxRows: 28 }}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />
        {!isOwner && (
          <Typography.Text type="secondary">
            {t("chatSwitch.ownerOnly", "Only the owner can change this.")}
          </Typography.Text>
        )}
      </Flex>
    </Modal>
  );
}

export function BotSettings() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const {
    token: { colorBorderSecondary },
  } = theme.useToken();
  const session = useSession();
  const isOwner = session.data?.role === "OWNER";
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [agents, setAgents] = useState<AgentPersona[] | null>(null);
  const [agentsFailed, setAgentsFailed] = useState(false);
  const [editing, setEditing] = useState<AgentPersona | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getChatSettings()
      .then((s) => {
        setSettings(s);
        setThreshold(s.leadThreshold);
      })
      .catch(() => setSettings(null));
    listAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgentsFailed(true));
  }, []);

  const save = async (patch: Partial<ChatSettings>) => {
    setSaving(true);
    try {
      const next = await setChatSettings(patch);
      setSettings(next);
      setThreshold(next.leadThreshold);
    } catch (err) {
      setThreshold(settings?.leadThreshold ?? null);
      message.error(
        err instanceof Error
          ? err.message
          : t("chatSettings.saveFailed", "Could not save the setting."),
      );
    } finally {
      setSaving(false);
    }
  };

  const commitThreshold = () => {
    if (threshold === null || !settings) return;
    const v = Math.max(0, Math.min(100, Math.round(threshold)));
    if (v !== settings.leadThreshold) void save({ leadThreshold: v });
  };

  const ownerHint = isOwner
    ? undefined
    : t("chatSwitch.ownerOnly", "Only the owner can change this.");

  return (
    <Flex vertical gap={16}>
      <BotSwitches />

      {settings && (
        <Card size="small">
          <Flex wrap gap={24} align="center">
            <Flex align="center" gap={8} wrap>
              <Typography.Text strong>
                {t("chatSettings.pipeline", "Pipeline")}
              </Typography.Text>
              <Tooltip title={ownerHint}>
                <Segmented
                  aria-label={t("chatSettings.pipeline", "Pipeline")}
                  disabled={!isOwner || saving}
                  value={settings.pipeline}
                  onChange={(v) =>
                    void save({ pipeline: v as ChatSettings["pipeline"] })
                  }
                  options={[
                    {
                      value: "v2",
                      label: t("chatSettings.v2", "Three agents (v2)"),
                    },
                    {
                      value: "v1",
                      label: t("chatSettings.v1", "Single agent (v1)"),
                    },
                  ]}
                />
              </Tooltip>
            </Flex>
            <Flex align="center" gap={8}>
              <Typography.Text strong>
                {t("chatSettings.leadThreshold", "Lead threshold")}
              </Typography.Text>
              <Tooltip
                title={
                  ownerHint ??
                  t(
                    "chatSettings.leadThresholdHint",
                    "A chat the bot scores at or above this (0–100) is marked a lead.",
                  )
                }
              >
                <InputNumber
                  aria-label={t("chatSettings.leadThreshold", "Lead threshold")}
                  min={0}
                  max={100}
                  precision={0}
                  disabled={!isOwner || saving}
                  value={threshold}
                  onChange={(v) => setThreshold(v)}
                  onBlur={commitThreshold}
                  onPressEnter={commitThreshold}
                  style={{ width: 96 }}
                />
              </Tooltip>
            </Flex>
          </Flex>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title={t("chatAgents.title", "Agents")}>
            {agentsFailed ? (
              <Typography.Text type="secondary">
                {t("chatAgents.loadFailed", "Could not load the agents.")}
              </Typography.Text>
            ) : (
              <Flex vertical>
                {agents === null && <Skeleton active paragraph={{ rows: 4 }} />}
                {(agents ?? []).map((a, i) => (
                  <Flex
                    key={a.agent}
                    justify="space-between"
                    align="flex-start"
                    gap={12}
                    style={{
                      paddingBlock: 12,
                      borderTop:
                        i === 0
                          ? undefined
                          : `1px solid ${colorBorderSecondary}`,
                    }}
                  >
                    <Flex vertical gap={2} style={{ minWidth: 0 }}>
                      <Flex align="center" gap={8} wrap>
                        <Typography.Link onClick={() => setEditing(a)}>
                          {a.name}
                        </Typography.Link>
                        {!a.isDefault && (
                          <Tag color="blue" style={{ marginInline: 0 }}>
                            {t("chatAgents.edited", "Edited")}
                          </Tag>
                        )}
                      </Flex>
                      <Typography.Text>{a.task}</Typography.Text>
                      <Typography.Text type="secondary" code>
                        {a.model}
                      </Typography.Text>
                    </Flex>
                    <Button
                      size="small"
                      aria-label={t(
                        "chatAgents.openPersona",
                        "Persona of {{name}}",
                        {
                          name: a.name,
                        },
                      )}
                      onClick={() => setEditing(a)}
                    >
                      {t("chatAgents.persona", "Persona")}
                    </Button>
                  </Flex>
                ))}
              </Flex>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Simulator />
        </Col>
      </Row>

      {editing && (
        <PersonaModal
          key={editing.agent}
          agent={editing}
          isOwner={isOwner}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setAgents((list) =>
              (list ?? []).map((a) => (a.agent === next.agent ? next : a)),
            );
            setEditing(next);
          }}
        />
      )}
    </Flex>
  );
}
