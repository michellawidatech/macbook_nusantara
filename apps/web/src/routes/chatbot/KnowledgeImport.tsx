/**
 * Import the owner's answer sheet — paste a document of `Q:` / `A:` pairs and
 * keep the ones you want (owner ask 2026-09-18: "I have compiled lists of
 * questions").
 *
 * The pasting is the whole point: the owner writes these in Google Docs, and
 * retyping thirty answers one dialog at a time is how a knowledge base stays
 * empty. `parseQaText` (packages/domain) reads the text — the same reader the
 * server's `knowledge` CLI uses — and every pair is shown before anything is
 * saved, because the parser does not fix a document's mistakes and a person
 * should see a stray line before the bot starts quoting it.
 *
 * A question already in the knowledge base (same words, whatever the case,
 * spacing or emoji) is shown and left unticked: importing the same sheet twice
 * must not double every answer.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Checkbox,
  Flex,
  Input,
  List,
  Modal,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { parseQaText, questionKey } from "@nusantara/domain";
import { mutate, nextId, useDb } from "../../mock/store.js";

export function KnowledgeImport({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [text, setText] = useState("");
  /** Indexes the person unticked. Everything new starts ticked. */
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());

  const known = useMemo(
    () => new Set(db.knowledge.map((k) => questionKey(k.question))),
    [db.knowledge],
  );
  const parsed = useMemo(() => parseQaText(text), [text]);
  const rows = parsed.pairs.map((p, i) => ({
    ...p,
    index: i,
    duplicate: known.has(questionKey(p.question)),
  }));
  const chosen = rows.filter((r) => !r.duplicate && !skipped.has(r.index));

  const close = () => {
    setText("");
    setSkipped(new Set());
    onClose();
  };

  const save = () => {
    if (chosen.length === 0) return;
    const now = new Date().toISOString();
    mutate((d) => {
      for (const r of chosen) {
        d.knowledge.push({
          id: nextId("k"),
          question: r.question,
          answer: r.answer,
          active: true,
          updatedAt: now,
        });
      }
    });
    message.success(
      t(
        "knowledge.imported",
        "Imported {{n}} answers — the bot uses them on its next reply.",
        { n: chosen.length },
      ),
    );
    close();
  };

  return (
    <Modal
      open={open}
      width={860}
      title={t("knowledge.importTitle", "Import answers from a document")}
      okText={t("knowledge.importOk", "Import {{n}}", { n: chosen.length })}
      okButtonProps={{ disabled: chosen.length === 0 }}
      onOk={save}
      onCancel={close}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          {t(
            "knowledge.importHint",
            "Paste the whole document. Each question starts with “Q:” and its answer with “A:”; an answer can run over several lines.",
          )}
        </Typography.Text>
        <Input.TextArea
          aria-label={t("knowledge.importPaste", "The document's text")}
          autoSize={{ minRows: 6, maxRows: 12 }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSkipped(new Set());
          }}
          placeholder={"Q: Cod bisa ga kak?\nA: Bisa kak 😊 ..."}
        />
        {parsed.unanswered.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t(
              "knowledge.importUnanswered",
              "{{n}} questions have no “A:” line and will not be imported:",
              { n: parsed.unanswered.length },
            )}
            description={parsed.unanswered.join(" · ")}
          />
        )}
        {rows.length > 0 && (
          <List
            size="small"
            bordered
            style={{ maxHeight: 360, overflowY: "auto" }}
            header={
              <Typography.Text strong>
                {t(
                  "knowledge.importFound",
                  "{{n}} answers found, {{m}} selected",
                  { n: rows.length, m: chosen.length },
                )}
              </Typography.Text>
            }
            dataSource={rows}
            renderItem={(r) => (
              <List.Item>
                <Flex gap={12} align="flex-start" style={{ width: "100%" }}>
                  <Checkbox
                    checked={!r.duplicate && !skipped.has(r.index)}
                    disabled={r.duplicate}
                    aria-label={r.question}
                    onChange={(e) =>
                      setSkipped((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(r.index);
                        else next.add(r.index);
                        return next;
                      })
                    }
                  />
                  <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
                    <Flex gap={8} align="center" wrap>
                      <Typography.Text strong>{r.question}</Typography.Text>
                      {r.duplicate && (
                        <Tag>
                          {t(
                            "knowledge.importDuplicate",
                            "already in the knowledge base",
                          )}
                        </Tag>
                      )}
                    </Flex>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ marginBottom: 0, whiteSpace: "pre-line" }}
                      ellipsis={{ rows: 3, expandable: true }}
                    >
                      {r.answer}
                    </Typography.Paragraph>
                  </Flex>
                </Flex>
              </List.Item>
            )}
          />
        )}
      </Flex>
    </Modal>
  );
}
