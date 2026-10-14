/**
 * Import the owner's answer sheet from a spreadsheet — one column of
 * questions, one of answers (owner ask 2026-10-14: *"it is better if we use
 * excel / csv file"*). It replaces the 2026-09-18 dialog that took a pasted
 * `Q:` / `A:` document; `parseQaText` still reads that format for the
 * server's `knowledge` CLI.
 *
 * A file somebody keeps is the source of truth, which a paste never was. So a
 * question the knowledge base already has is no longer skipped: when the
 * file's answer differs it is offered as a CHANGE, with today's answer shown
 * under the new one, and it is ticked like a new row (owner answer, same
 * day). A question the file does not mention is left alone.
 *
 * Every row is shown before anything is saved, for the reason the paste
 * dialog gave: the reader does not fix a sheet's mistakes, and a person
 * should see a stray row before the bot starts quoting it. Nothing is
 * uploaded anywhere — the file is read in this browser.
 */
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Checkbox,
  Flex,
  List,
  Modal,
  Tag,
  Typography,
  Upload,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { QaSheet } from "@nusantara/domain";
import { mutate, nextId, useDb } from "../../mock/store.js";
import {
  planKnowledgeImport,
  readKnowledgeFile,
} from "../../lib/knowledgeSheet.js";
import { XlsxError } from "../../lib/xlsxRead.js";

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
  const [sheet, setSheet] = useState<QaSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Indexes the person unticked. Everything new or changed starts ticked. */
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  /** Guards a second file landing while the first is still being read. */
  const reading = useRef(false);

  const rows = useMemo(
    () => planKnowledgeImport(sheet?.pairs ?? [], db.knowledge),
    [sheet, db.knowledge],
  );
  const chosen = rows.filter(
    (r) => r.state !== "same" && !skipped.has(r.index),
  );
  const added = chosen.filter((r) => r.state === "new").length;
  const changed = chosen.length - added;

  const close = () => {
    setSheet(null);
    setFileName("");
    setError(null);
    setSkipped(new Set());
    onClose();
  };

  const take = async (file: File) => {
    if (reading.current) return;
    reading.current = true;
    try {
      setSheet(await readKnowledgeFile(file));
      setFileName(file.name);
      setError(null);
    } catch (e) {
      setSheet(null);
      setFileName("");
      setError(
        e instanceof XlsxError
          ? t(
              "knowledge.importUnreadable",
              "This file could not be read. Save it as .xlsx or .csv and try again.",
            )
          : t("knowledge.importFailed", "The file could not be opened."),
      );
    } finally {
      setSkipped(new Set());
      reading.current = false;
    }
  };

  const save = () => {
    if (chosen.length === 0) return;
    const now = new Date().toISOString();
    mutate((d) => {
      for (const r of chosen) {
        const known =
          r.id === undefined
            ? undefined
            : d.knowledge.find((k) => k.id === r.id);
        if (known) {
          known.answer = r.answer;
          known.updatedAt = now;
        } else {
          d.knowledge.push({
            id: nextId("k"),
            question: r.question,
            answer: r.answer,
            active: true,
            updatedAt: now,
          });
        }
      }
    });
    message.success(
      t(
        "knowledge.importedSheet",
        "{{added}} added, {{changed}} updated — the bot uses them on its next reply.",
        { added, changed },
      ),
    );
    close();
  };

  return (
    <Modal
      open={open}
      width={860}
      title={t("knowledge.importTitle", "Import answers from a file")}
      okText={t("knowledge.importOk", "Import {{n}}", { n: chosen.length })}
      okButtonProps={{ disabled: chosen.length === 0 }}
      onOk={save}
      onCancel={close}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Upload.Dragger
          accept=".xlsx,.csv"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            void take(file as unknown as File);
            // Read in this browser; there is nothing for antd to upload.
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {fileName === ""
              ? t("knowledge.importDrop", "Drop an .xlsx or .csv file here")
              : fileName}
          </p>
          <p className="ant-upload-hint">
            {t(
              "knowledge.importColumns",
              "Column A is the question and column B the answer. A first row reading “Question” and “Answer” is skipped.",
            )}
          </p>
        </Upload.Dragger>

        {error !== null && <Alert type="error" showIcon title={error} />}
        {sheet !== null && rows.length === 0 && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "knowledge.importEmpty",
              "No question with an answer was found in this file.",
            )}
          />
        )}
        {sheet !== null && sheet.unanswered.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "knowledge.importUnanswered",
              "{{n}} questions have no answer and will not be imported:",
              { n: sheet.unanswered.length },
            )}
            description={sheet.unanswered.join(" · ")}
          />
        )}
        {sheet !== null && sheet.repeated.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "knowledge.importRepeated",
              "{{n}} questions appear twice in the file; only the first of each is read:",
              { n: sheet.repeated.length },
            )}
            description={sheet.repeated.join(" · ")}
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
                  "knowledge.importFoundSheet",
                  "{{n}} answers in the file — {{added}} new and {{changed}} changed selected",
                  { n: rows.length, added, changed },
                )}
              </Typography.Text>
            }
            dataSource={rows}
            renderItem={(r) => (
              <List.Item>
                <Flex gap={12} align="flex-start" style={{ width: "100%" }}>
                  <Checkbox
                    checked={r.state !== "same" && !skipped.has(r.index)}
                    disabled={r.state === "same"}
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
                      {r.state === "new" && (
                        <Tag color="green">
                          {t("knowledge.importNew", "new")}
                        </Tag>
                      )}
                      {r.state === "changed" && (
                        <Tag color="gold">
                          {t("knowledge.importChanged", "answer changed")}
                        </Tag>
                      )}
                      {r.state === "same" && (
                        <Tag>{t("knowledge.importSame", "no change")}</Tag>
                      )}
                    </Flex>
                    <Typography.Paragraph
                      type={r.state === "same" ? "secondary" : undefined}
                      style={{ marginBottom: 0, whiteSpace: "pre-line" }}
                      ellipsis={{ rows: 3, expandable: true }}
                    >
                      {r.answer}
                    </Typography.Paragraph>
                    {r.current !== undefined && (
                      <Typography.Paragraph
                        type="secondary"
                        delete
                        style={{ marginBottom: 0, whiteSpace: "pre-line" }}
                        ellipsis={{ rows: 2, expandable: true }}
                      >
                        {r.current}
                      </Typography.Paragraph>
                    )}
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
