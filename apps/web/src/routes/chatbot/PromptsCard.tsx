/**
 * The bot's prompts (owner, 2026-10-28: "set the prompt — can choose & have
 * multiple but 1 is used"). A list; exactly one is In use (`Persona.active`),
 * and *Use this* switches to another at once — the worker reads it on its
 * next pass. Add, edit and delete are the owner's; the prompt in use and the
 * built-in default cannot be deleted, and the built-in one is copied rather
 * than edited.
 */
import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  activatePersona,
  createPersona,
  deletePersona,
  listPersonas,
  updatePersona,
  type Persona,
} from "../../lib/chatApi.js";
import { fmtDateTime } from "../../lib/format.js";

interface Editing {
  readonly id: string | null;
  readonly name: string;
  readonly prompt: string;
}

export function PromptsCard({ isOwner }: { readonly isOwner: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Persona[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ name: string; prompt: string }>();

  const load = () =>
    listPersonas()
      .then((r) => setRows(r.personas))
      .catch(() => setRows([]));
  useEffect(() => {
    void load();
  }, []);

  const failed = (err: unknown) =>
    message.error(
      err instanceof Error
        ? err.message
        : t("chatPrompts.failed", "That did not work."),
    );

  const open = (e: Editing) => {
    setEditing(e);
    form.setFieldsValue({ name: e.name, prompt: e.prompt });
  };

  const save = async () => {
    if (!editing) return;
    const v = await form.validateFields().catch(() => null);
    if (v === null) return;
    setBusy(true);
    try {
      if (editing.id) await updatePersona(editing.id, v);
      else await createPersona(v);
      setEditing(null);
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      failed(err);
    }
  };

  const inUse = rows?.find((p) => p.active);

  return (
    <Card
      title={t("chatPrompts.title", "Prompts")}
      extra={
        isOwner && (
          <Button
            type="primary"
            size="small"
            onClick={() => open({ id: null, name: "", prompt: "" })}
          >
            {t("chatPrompts.add", "Add prompt")}
          </Button>
        )
      }
    >
      {rows !== null && !inUse && (
        <Typography.Paragraph type="secondary">
          {t(
            "chatPrompts.noneInUse",
            "No prompt is marked in use, so the bot uses its built-in default.",
          )}
        </Typography.Paragraph>
      )}
      <Table<Persona>
        size="small"
        rowKey="id"
        loading={rows === null}
        dataSource={rows ?? []}
        pagination={false}
        columns={[
          {
            key: "name",
            title: t("chatPrompts.name", "Name"),
            render: (_, p) => (
              <Flex vertical gap={2}>
                <Flex gap={6} align="center" wrap>
                  <Typography.Text strong>{p.name}</Typography.Text>
                  {p.active && (
                    <Tag color="green" style={{ marginInline: 0 }}>
                      {t("chatPrompts.inUse", "In use")}
                    </Tag>
                  )}
                  {p.builtIn && (
                    <Tag style={{ marginInline: 0 }}>
                      {t("chatPrompts.builtIn", "Built in")}
                    </Tag>
                  )}
                </Flex>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("chatPrompts.updated", "Updated {{when}}", {
                    when: fmtDateTime(p.updatedAt),
                  })}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            key: "actions",
            title: "",
            align: "right",
            width: 260,
            render: (_, p) =>
              isOwner && (
                <Flex gap={4} justify="end" wrap>
                  {!p.active && (
                    <Button
                      size="small"
                      onClick={() => void act(() => activatePersona(p.id))}
                    >
                      {t("chatPrompts.use", "Use this")}
                    </Button>
                  )}
                  <Button
                    size="small"
                    onClick={() =>
                      open(
                        p.builtIn
                          ? {
                              id: null,
                              name: t(
                                "chatPrompts.copyOf",
                                "Copy of {{name}}",
                                {
                                  name: p.name,
                                },
                              ),
                              prompt: p.prompt,
                            }
                          : { id: p.id, name: p.name, prompt: p.prompt },
                      )
                    }
                  >
                    {p.builtIn
                      ? t("chatPrompts.copy", "Copy")
                      : t("chatPrompts.edit", "Edit")}
                  </Button>
                  <Popconfirm
                    title={t(
                      "chatPrompts.deleteConfirm",
                      "Delete this prompt?",
                    )}
                    okText={t("chatPrompts.delete", "Delete")}
                    cancelText={t("common.cancel", "Cancel")}
                    disabled={p.active || p.builtIn}
                    onConfirm={() => void act(() => deletePersona(p.id))}
                  >
                    <Button
                      size="small"
                      danger
                      disabled={p.active || p.builtIn}
                    >
                      {t("chatPrompts.delete", "Delete")}
                    </Button>
                  </Popconfirm>
                </Flex>
              ),
          },
        ]}
      />
      <Modal
        open={editing !== null}
        title={
          editing?.id
            ? t("chatPrompts.editTitle", "Edit prompt")
            : t("chatPrompts.addTitle", "New prompt")
        }
        okText={t("common.save", "Save")}
        cancelText={t("common.cancel", "Cancel")}
        confirmLoading={busy}
        onOk={() => void save()}
        onCancel={() => setEditing(null)}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t("chatPrompts.name", "Name")}
            rules={[
              {
                required: true,
                message: t("chatPrompts.nameRequired", "Give it a name."),
              },
            ]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="prompt"
            label={t("chatPrompts.prompt", "Prompt")}
            rules={[
              {
                required: true,
                message: t("chatPrompts.promptRequired", "Write the prompt."),
              },
            ]}
          >
            <Input.TextArea rows={14} maxLength={8000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
