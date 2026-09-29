/**
 * Q&A the chatbot grounds its answers in. Staff curate; the agent only reads.
 *
 * A panel rather than a page since the 2026-08-26 merge — it is the second tab
 * of `ChatbotPage`. The two were separate nav items for one job: what the bot
 * said, and what it knows to say. Reading a bad reply and fixing the answer
 * behind it was two screens and a lost train of thought.
 *
 * "Add Q&A" lives in the table's own toolbar rather than as a page action.
 * Now that the frame belongs to a tabbed page, a page-level button would have
 * to appear and disappear as tabs changed — and a primary action that comes
 * and goes is one nobody trusts. It is an action on this list, so it sits on
 * this list.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Switch,
  Tooltip,
} from "antd";
import { EditOutlined, ImportOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable } from "../../components/ProTable";
import { LongText } from "../../components/LongText";
import { fmtDate } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import { useTranslation } from "react-i18next";
import type { Knowledge } from "../../mock/seed.js";
import { KnowledgeImport } from "./KnowledgeImport.js";
import { COLUMN } from "../../theme/tokens";

export function KnowledgePanel() {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ question: string; answer: string }>();
  const [editing, setEditing] = useState<Knowledge | "new" | null>(null);
  const [importing, setImporting] = useState(false);

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
      message.success(
        t(
          "knowledge.saved",
          "Knowledge saved — the agent uses it on the next reply.",
        ),
      );
      setEditing(null);
    });

  return (
    <Card>
      <ProTable
        persistKey="knowledge"
        rowKey="id"
        dataSource={db.knowledge}
        searchPlaceholder={t(
          "knowledge.search",
          "Search a question or an answer",
        )}
        extra={
          <Flex gap={8} wrap>
            <Button
              icon={<ImportOutlined />}
              onClick={() => setImporting(true)}
            >
              {t("knowledge.import", "Import from a document")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => open("new")}
            >
              {t("knowledge.add", "Add Q&A")}
            </Button>
          </Flex>
        }
        columns={[
          {
            title: t("knowledge.question", "Question"),
            dataIndex: "question",
            width: 320,
            searchable: true,
          },
          {
            // The approved answer runs to a sentence or two by definition —
            // it is what the bot will say — so it gets two lines rather than
            // antd's one-line clamp. See `LongText`. A width of its own, so
            // the longest answer wraps inside the column instead of widening
            // the table to one line of it.
            title: t("knowledge.answer", "Answer"),
            dataIndex: "answer",
            width: 460,
            searchable: true,
            render: (v: string) => <LongText>{v}</LongText>,
          },
          {
            // Pinned to the right with the switch and the pencil beside it
            // (owner ask 2026-09-18): a long answer scrolled them off the
            // screen, and they are what somebody working down the list uses.
            title: t("knowledge.updated", "Updated"),
            dataIndex: "updatedAt",
            width: 140,
            fixed: "right",
            defaultSortOrder: "descend",
            render: fmtDate,
          },
          {
            title: t("knowledge.active", "Active"),
            key: "active",
            width: 110,
            fixed: "right",
            facet: true,
            facetLabel: t("knowledge.anyState", "Any state"),
            // The filter offers words, not `true`/`false` — a checkbox list
            // reading "true" is a database leaking into the UI.
            facetValue: (k) =>
              k.active
                ? t("knowledge.on", "Active")
                : t("knowledge.off", "Inactive"),
            sortValue: (k) => (k.active ? 1 : 0),
            render: (_, k) => (
              <Switch
                size="small"
                checked={k.active}
                aria-label={t("knowledge.toggleAria", "Use this answer")}
                onChange={(on) =>
                  mutate((d) => {
                    d.knowledge.find((x) => x.id === k.id)!.active = on;
                  })
                }
              />
            ),
          },
          {
            // An icon, like every other row action in the app since
            // 2026-08-26. The `aria-label` names the question being edited,
            // which the bare word "Edit" repeated down a column never did.
            title: "",
            key: "actions",
            width: COLUMN.actions,
            fixed: "right",
            render: (_, k) => (
              <Tooltip title={t("common.edit", "Edit")}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  aria-label={t("knowledge.editAria", "Edit “{{question}}”", {
                    question: k.question,
                  })}
                  onClick={() => open(k)}
                />
              </Tooltip>
            ),
          },
        ]}
      />

      <KnowledgeImport open={importing} onClose={() => setImporting(false)} />

      <Modal
        title={
          editing === "new"
            ? t("knowledge.add", "Add Q&A")
            : t("knowledge.edit", "Edit Q&A")
        }
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={save}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="question"
            label={t("knowledge.question", "Question")}
            rules={[{ required: true }]}
          >
            <Input
              placeholder={t("knowledge.questionHint", "What customers ask")}
            />
          </Form.Item>
          <Form.Item
            name="answer"
            label={t("knowledge.answer", "Answer")}
            rules={[{ required: true }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t(
                "knowledge.answerHint",
                "The approved answer the bot should give",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
