/**
 * The knowledge base as a spreadsheet — a column of questions and a column of
 * answers (owner ask 2026-10-14). `packages/domain`'s `qaSheet` owns the
 * reading of the rows; this is the part that needs a browser's file and the
 * knowledge base to compare against.
 *
 * The sheet is the source of truth, so an upload is a three-way comparison,
 * not a filter for what is new: a question the base already has under a
 * DIFFERENT answer is offered as a change (owner answer 2026-10-14), and the
 * dialog shows the old answer beside the new one before anything is saved. A
 * question the file leaves out is left alone — an upload of five corrected
 * rows must not be read as "delete the other twenty-six".
 */
import {
  parseCsv,
  qaFromRows,
  questionKey,
  type QaPair,
  type QaSheet,
} from "@nusantara/domain";
import { readXlsx } from "./xlsxRead.js";
import type { XlsxSheet } from "./xlsxWrite.js";

export type SheetRowState = "new" | "changed" | "same";

export interface SheetRow extends QaPair {
  readonly index: number;
  readonly state: SheetRowState;
  /** The entry this question already is, when it is one. */
  readonly id?: string;
  /** What the base says today, when the file says something else. */
  readonly current?: string;
}

/** Line endings and outer spaces do not make an answer a different answer. */
const sameText = (a: string, b: string): boolean =>
  a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();

export function planKnowledgeImport(
  pairs: readonly QaPair[],
  existing: ReadonlyArray<{ id: string; question: string; answer: string }>,
): SheetRow[] {
  const known = new Map<string, { id: string; answer: string }>();
  // The first entry wins, as it does inside the file: a base that already
  // holds one question twice has one of them corrected, not both.
  for (const k of existing) {
    const key = questionKey(k.question);
    if (!known.has(key)) known.set(key, { id: k.id, answer: k.answer });
  }
  return pairs.map((p, index) => {
    const hit = known.get(questionKey(p.question));
    if (!hit) return { ...p, index, state: "new" };
    return sameText(hit.answer, p.answer)
      ? { ...p, index, state: "same", id: hit.id }
      : { ...p, index, state: "changed", id: hit.id, current: hit.answer };
  });
}

/** Is this a file to read as text rather than as a workbook? */
export const isCsvName = (name: string): boolean =>
  /\.(csv|tsv|txt)$/i.test(name);

/**
 * A chosen file as question/answer pairs. An .xlsx is read from its first
 * sheet that has anything on it — a workbook's other tabs are somebody's
 * notes. Throws `XlsxError` for a workbook that cannot be read.
 */
export async function readKnowledgeFile(file: {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<QaSheet> {
  const bytes = await file.arrayBuffer();
  if (isCsvName(file.name)) {
    return qaFromRows(parseCsv(new TextDecoder("utf-8").decode(bytes)));
  }
  const sheets = await readXlsx(bytes);
  const sheet = sheets.find((s) => s.rows.some((r) => r.length > 0));
  return qaFromRows(sheet?.rows ?? []);
}

/**
 * The knowledge base as the workbook an upload reads back — which makes it
 * the template too: an empty base downloads as the two headings.
 */
export function knowledgeWorkbook(
  knowledge: ReadonlyArray<{ question: string; answer: string }>,
): XlsxSheet {
  return {
    name: "Knowledge",
    freezeRows: 1,
    columnWidths: [48, 96],
    rows: [
      [
        { v: "Question", s: "header" },
        { v: "Answer", s: "header" },
      ],
      ...knowledge.map((k) => [k.question, k.answer]),
    ],
  };
}
