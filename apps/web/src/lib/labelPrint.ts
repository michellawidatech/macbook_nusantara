/**
 * Printing the stickers from a frame of their own (2026-11-03).
 *
 * The labels used to print from the app's own page, on a NAMED page
 * (`label-sheet`) attached to an absolutely positioned root. CSS ignores
 * `page:` on an out-of-flow box, so the browser printed on its default paper
 * — A4 with the invoice's margins — and the thermal driver shrank and turned
 * that A4 onto the 50 × 30 mm sticker: a small QR and sideways text.
 *
 * A frame whose document holds only the stickers and an UNNAMED page rule is
 * the one arrangement every browser sizes its paper from. Nothing else on the
 * app's page is affected, and the invoice keeps its own margins.
 */
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from "./labelSize.js";

/** The whole document the frame prints. `markup` is the rendered stickers. */
export function labelPrintDocument(markup: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Labels</title>',
    "<style>",
    `@page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }`,
    "html, body { margin: 0; padding: 0; background: #fff; }",
    ".label-qr svg { width: 100%; height: 100%; display: block; }",
    "</style></head><body>",
    markup,
    "</body></html>",
  ].join("");
}

/**
 * Print `markup` in a hidden frame and take the frame away afterwards. The
 * caller passes the stickers' HTML (already holding their QR codes).
 */
export function printLabels(markup: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(labelPrintDocument(markup));
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 0);
  win.addEventListener("afterprint", done, { once: true });
  // After layout, or the first print of a session can come out blank.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 50);
}
