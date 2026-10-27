/**
 * The one file that touches pdf.js (2026-10-27).
 *
 * A hand-written PDF READER is not realistic the way `lib/pdfWrite.ts` was a
 * realistic writer: a bank's statement arrives with compressed streams,
 * embedded subset fonts and their own encodings, and reading its text back is
 * most of what pdf.js is. So it is the reconciliation's one new dependency,
 * and it is kept off every other screen: `readStatementFile` IMPORTS IT
 * DYNAMICALLY, so the bundler splits pdf.js and its worker into chunks of
 * their own that only the Reconciliation page ever fetches.
 *
 * Everything that reads the statement's layout is in `lib/bankStatement.ts`,
 * pure, and takes the positioned text this file produces — which is what lets
 * the tests run the real pdf.js (its Node build) on a synthetic statement and
 * the page run the browser build on the bank's.
 */
import {
  parseBcaCsv,
  parseBcaPages,
  type ParsedStatement,
  type PdfPage,
  type PdfTextItem,
} from "./bankStatement.js";

/** The part of a pdf.js text item read here. */
interface PdfJsTextItem {
  readonly str?: string;
  readonly transform?: readonly number[];
  readonly width?: number;
}

/** The part of pdf.js this file uses — the browser build and the Node one both fit. */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): {
    readonly promise: Promise<{
      readonly numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ readonly items: readonly unknown[] }>;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Every page's text, with where pdf.js put each piece. Empty pieces are dropped. */
export async function pagesOfPdf(
  pdfjs: PdfJsLike,
  bytes: Uint8Array,
): Promise<PdfPage[]> {
  // pdf.js takes ownership of the buffer it is given; hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise;
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        const it = raw as PdfJsTextItem;
        if (typeof it.str !== "string" || it.str.trim() === "") continue;
        const t = it.transform;
        if (t === undefined || t.length < 6) continue;
        items.push({
          str: it.str,
          x: t[4]!,
          y: t[5]!,
          width: it.width ?? 0,
        });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Is this a PDF? By its first bytes, which a renamed file cannot hide. */
function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

/**
 * An uploaded statement — BCA's e-statement PDF or KlikBCA's CSV — read into
 * lines. Throws `StatementReadError` for a file it cannot read; whether the
 * statement ADDS UP is `checkStatement`'s question, asked by the caller.
 */
export async function readStatementFile(file: File): Promise<ParsedStatement> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPdf(bytes)) {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return parseBcaPages(
      await pagesOfPdf(pdfjs as unknown as PdfJsLike, bytes),
    );
  }
  return parseBcaCsv(new TextDecoder("utf-8").decode(bytes));
}
