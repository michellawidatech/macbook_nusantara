/**
 * A list of WhatsApp numbers with a name beside each (owner, 2026-10-28:
 * "CRUD list of testers, CRUD list of alert numbers … name as well"). One
 * component for both lists; the server stores and validates them. Add, edit
 * and delete are the owner's.
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
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  getNumberList,
  setNumberList,
  type NumberEntry,
  type NumberListPath,
} from "../../lib/chatApi.js";
import { fmtNone } from "../../lib/format.js";

export function NumberListCard({
  path,
  title,
  hint,
  isOwner,
}: {
  readonly path: NumberListPath;
  readonly title: string;
  readonly hint: string;
  readonly isOwner: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [rows, setRows] = useState<NumberEntry[] | null>(null);
  /** The row being edited, by index, or "new". */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ name: string; number: string }>();

  useEffect(() => {
    getNumberList(path)
      .then((r) => setRows(r.entries))
      .catch(() => setRows([]));
  }, [path]);

  const save = async (next: ReadonlyArray<NumberEntry>) => {
    setBusy(true);
    try {
      const r = await setNumberList(
        path,
        next.map((e) => ({ number: e.waId, name: e.name })),
      );
      setRows(r.entries);
      return true;
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatNumbers.saveFailed", "Could not save the numbers."),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (editing === null || rows === null) return;
    const v = await form.validateFields().catch(() => null);
    if (v === null) return;
    const entry = { waId: v.number.trim(), name: v.name.trim() };
    const next =
      editing === "new"
        ? [...rows, entry]
        : rows.map((r, i) => (i === editing ? entry : r));
    if (await save(next)) setEditing(null);
  };

  const open = (i: number | "new") => {
    const r = i === "new" ? null : rows?.[i];
    form.setFieldsValue({ name: r?.name ?? "", number: r?.waId ?? "" });
    setEditing(i);
  };

  return (
    <Card
      title={title}
      extra={
        isOwner && (
          <Button type="primary" size="small" onClick={() => open("new")}>
            {t("chatNumbers.add", "Add")}
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">{hint}</Typography.Paragraph>
      <Table<NumberEntry & { i: number }>
        size="small"
        rowKey="waId"
        loading={rows === null}
        dataSource={(rows ?? []).map((r, i) => ({ ...r, i }))}
        pagination={false}
        locale={{ emptyText: t("chatNumbers.empty", "No numbers yet.") }}
        columns={[
          {
            key: "name",
            title: t("chatNumbers.name", "Name"),
            render: (_, r) => r.name || fmtNone(),
          },
          {
            key: "number",
            title: t("chatNumbers.number", "Number"),
            render: (_, r) => r.waId,
          },
          {
            key: "actions",
            title: "",
            align: "right",
            width: 160,
            render: (_, r) =>
              isOwner && (
                <Flex gap={4} justify="end">
                  <Button size="small" onClick={() => open(r.i)}>
                    {t("chatNumbers.edit", "Edit")}
                  </Button>
                  <Popconfirm
                    title={t(
                      "chatNumbers.deleteConfirm",
                      "Remove this number?",
                    )}
                    okText={t("chatNumbers.delete", "Delete")}
                    cancelText={t("common.cancel", "Cancel")}
                    onConfirm={() =>
                      void save((rows ?? []).filter((_, i) => i !== r.i))
                    }
                  >
                    <Button size="small" danger>
                      {t("chatNumbers.delete", "Delete")}
                    </Button>
                  </Popconfirm>
                </Flex>
              ),
          },
        ]}
      />
      <Modal
        open={editing !== null}
        title={title}
        okText={t("common.save", "Save")}
        cancelText={t("common.cancel", "Cancel")}
        confirmLoading={busy}
        onOk={() => void submit()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t("chatNumbers.name", "Name")}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item
            name="number"
            label={t("chatNumbers.number", "Number")}
            rules={[
              {
                required: true,
                message: t("chatNumbers.numberRequired", "Type the number."),
              },
            ]}
          >
            <Input
              inputMode="tel"
              placeholder={t("chatNumbers.placeholder", "0812… or 62812…")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
