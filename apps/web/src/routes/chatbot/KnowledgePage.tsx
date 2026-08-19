/** Q&A the chatbot grounds its answers in. Staff curate; the agent only reads. */
import { useState } from "react";
import { App, Button, Card, Form, Input, Modal, Switch } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { fmtDate } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { Knowledge } from "../../mock/seed.js";

export function KnowledgePage() {
  const db = useDb();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ question: string; answer: string }>();
  const [editing, setEditing] = useState<Knowledge | "new" | null>(null);

  const open = (k: Knowledge | "new") => {
    setEditing(k);
    form.setFieldsValue(k === "new" ? { question: "", answer: "" } : k);
  };

  const save = () =>
    form.validateFields().then((v) => {
      mutate((d) => {
        if (editing === "new") {
          d.knowledge.unshift({
            id: nextId("k"),
            question: v.question,
            answer: v.answer,
            active: true,
            updatedAt: new Date().toISOString(),
          });
        } else if (editing) {
          const k = d.knowledge.find((x) => x.id === editing.id)!;
          k.question = v.question;
          k.answer = v.answer;
          k.updatedAt = new Date().toISOString();
        }
      });
      message.success("Knowledge saved — the agent uses it on the next reply.");
      setEditing(null);
    });

  return (
    <PageContainer
      title="Chatbot Knowledge"
      actions={[
        {
          key: "add",
          label: "Add Q&A",
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => open("new"),
        },
      ]}
    >
      <Card>
        <DataTable
          rowKey="id"
          dataSource={db.knowledge}
          columns={[
            { title: "Question", dataIndex: "question", width: 320 },
            { title: "Answer", dataIndex: "answer", ellipsis: true },
            {
              title: "Updated",
              dataIndex: "updatedAt",
              width: 130,
              render: fmtDate,
            },
            {
              title: "Active",
              width: 90,
              render: (_, k) => (
                <Switch
                  size="small"
                  checked={k.active}
                  onChange={(on) =>
                    mutate((d) => {
                      d.knowledge.find((x) => x.id === k.id)!.active = on;
                    })
                  }
                />
              ),
            },
            {
              title: "",
              width: 80,
              render: (_, k) => (
                <Button size="small" onClick={() => open(k)}>
                  Edit
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing === "new" ? "Add Q&A" : "Edit Q&A"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={save}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="question"
            label="Question"
            rules={[{ required: true }]}
          >
            <Input placeholder="What customers ask" />
          </Form.Item>
          <Form.Item name="answer" label="Answer" rules={[{ required: true }]}>
            <Input.TextArea
              rows={4}
              placeholder="The approved answer the bot should give"
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
