/**
 * Settings — how the bot is put together (owner ask 2026-10-15).
 *
 * On top: the four "may answer" switches and the testers (moved here off the
 * Chat tab, where they were a bar above every conversation). Below, the
 * agent with its persona prompt on the left, and the simulator on the right
 * to try a change out on.
 *
 * ONE agent, and nothing to choose (owner, 2026-10-21: "keep it a single
 * agent on the chatbot and the user cannot choose / determine the lead"). The
 * pipeline picker and the lead threshold are gone; the server decides both
 * (`chatbotSettings`) and this screen only reads what it decided.
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
  Input,
  Modal,
  Row,
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
  const {
    token: { colorBorderSecondary },
  } = theme.useToken();
  const session = useSession();
  const isOwner = session.data?.role === "OWNER";
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [agents, setAgents] = useState<AgentPersona[] | null>(null);
  const [agentsFailed, setAgentsFailed] = useState(false);
  const [editing, setEditing] = useState<AgentPersona | null>(null);

  useEffect(() => {
    getChatSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
    listAgents()
      // The one agent is the Advisor's seat — the one the worker answers
      // with. Router and Operations belong to the dormant three-agent bot.
      .then((r) => setAgents(r.agents.filter((a) => a.agent === "ADVISOR")))
      .catch(() => setAgentsFailed(true));
  }, []);

  return (
    <Flex vertical gap={16}>
      <BotSwitches />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title={t("chatAgents.titleOne", "Agent")}>
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
                      <Typography.Text>
                        {settings?.pipeline === "rules" ? a.inRules : a.task}
                      </Typography.Text>
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
