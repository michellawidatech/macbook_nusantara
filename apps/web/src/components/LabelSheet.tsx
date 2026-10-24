/**
 * Printable serial labels — one 50 × 30 mm sticker per page, always.
 *
 * ## The sticker (owner, 2026-10-22)
 *
 * *"Remove the customization, the user always print the label in 50 x 30
 * mm."* The page setup of 2026-08-28 — sheet or roll, paper size, sticker
 * size, gap, margin, QR or Code 128 — is gone: the shop prints on one thermal
 * printer and one stock, and every option was another way for the print to
 * miss it. A label is a page: `@page { size: 50mm 30mm; margin: 0 }`, each
 * sticker exactly that size with a page break after it.
 *
 * Landscape. On the LEFT a square QR of the serial as stored, 26 mm, which
 * leaves a 2 mm margin above and below. On the RIGHT two blocks of text: the
 * product's name and, under it, the SKU code (`Sku.code`). **No serial text**
 * (owner answer) — the serial is in the QR and on the unit already.
 *
 * Everything is in absolute millimetres, positioned rather than flowed, and
 * each text block is clamped to three lines and clipped: a long product name
 * is cut short with an ellipsis rather than pushing the sticker onto a second
 * page of the roll.
 *
 * A QR rather than bars because the shop reads its own stickers with its own
 * phones, and a QR carries error correction a creased label needs.
 *
 * ## What may be printed at all
 *
 * Every serial is inspected before the dialog will print it
 * (`inspectStoredSerial`). An empty or unencodable one is refused outright:
 * there is nothing to draw. A serial that merely looks wrong — an `I` where a
 * `1` belongs, a dash — is named and printed anyway. See that function for why
 * the two get different answers.
 *
 * Printing reuses the visibility switch in global.css rather than opening a
 * second window, the same mechanism `Invoice` uses, on a NAMED page
 * (`label-sheet`) so the invoice's 12 mm margin and the sticker's zero do not
 * overwrite each other.
 */
import { useEffect, useState } from "react";
import { Alert, App, Button, Flex, Modal, Tag, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import type { LabelDatum } from "../lib/labels.js";
import {
  inspectStoredSerial,
  isPrintableSerial,
  type SerialFault,
  type SerialInspection,
} from "../lib/serialScan.js";

export type { LabelDatum };

/** The one sticker the shop prints. */
export const LABEL_WIDTH_MM = 50;
export const LABEL_HEIGHT_MM = 30;
/** Ink stays this far off the die-cut edge. */
const PAD_MM = 2;
/** The QR's side: the sticker's height less a margin above and below. */
export const QR_MM = LABEL_HEIGHT_MM - PAD_MM * 2;
/** Between the QR and the text. */
const GUTTER_MM = 1.5;

/**
 * The page rule. Emitted from here as well as written in global.css so that
 * the size is stated where the sticker is drawn; `@page` has no selector, so
 * the later of the two wins and they say the same thing.
 */
export const LABEL_PAGE_RULE = `@page label-sheet { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }`;

/** `qrcode`'s SVG carries a viewBox and no size; it fills its box. */
const QR_SVG_RULE =
  ".label-qr > svg { display: block; width: 100%; height: 100%; }";

/**
 * QR markup for each serial, keyed by serial.
 *
 * Generated in an effect because `qrcode` is async, and cached across renders
 * so that re-rendering does not re-encode every QR. SVG rather than a PNG data
 * URL: a rasterised QR at sticker size scans on the screen and fails on paper.
 */
function useQrCodes(serials: readonly string[]): Record<string, string> {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const key = serials.join(" ");

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      const entries = await Promise.all(
        // Only what can actually be encoded. `QRCode.toString("")` rejects,
        // and one rejection inside `Promise.all` takes the whole batch down.
        serials.filter(isPrintableSerial).map(
          async (s) =>
            [
              s,
              await QRCode.toString(s, {
                type: "svg",
                // No quiet zone from the library: the sticker's own margin
                // provides it, and the default 4 modules would shrink the
                // modules for nothing.
                margin: 0,
                errorCorrectionLevel: "M",
              }),
            ] as const,
        ),
      );
      if (!cancelled) setCodes(Object.fromEntries(entries));
    };
    void build();
    return () => {
      cancelled = true;
    };
    // `key` stands in for the array so a new array of the same serials does
    // not re-encode everything.
  }, [key]);

  return codes;
}

/** Up to three lines, then an ellipsis — never onto the next sticker. */
const clamp = (fontMm: number, weight: number): React.CSSProperties => ({
  fontSize: `${fontMm}mm`,
  fontWeight: weight,
  lineHeight: 1.15,
  maxHeight: `${fontMm * 1.15 * 3}mm`,
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
});

/** One sticker, which is one page. */
function Label({
  datum,
  qrSvg,
  last,
  preview,
}: {
  datum: LabelDatum;
  qrSvg: string | undefined;
  last: boolean;
  preview: boolean;
}) {
  return (
    <div
      className="label-cell"
      style={{
        position: "relative",
        width: `${LABEL_WIDTH_MM}mm`,
        height: `${LABEL_HEIGHT_MM}mm`,
        boxSizing: "border-box",
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        // A break after every sticker but the last, so the roll feeds one
        // sticker per label and no blank one at the end.
        breakAfter: last ? "auto" : "page",
        pageBreakAfter: last ? "auto" : "always",
        breakInside: "avoid",
        ...(preview ? { outline: "1px dashed #bfbfbf" } : {}),
      }}
    >
      <div
        className="label-qr"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `${PAD_MM}mm`,
          top: `${PAD_MM}mm`,
          width: `${QR_MM}mm`,
          height: `${QR_MM}mm`,
        }}
        // Locally generated markup from `qrcode`, never user HTML.
        dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }}
      />
      <div
        style={{
          position: "absolute",
          left: `${PAD_MM + QR_MM + GUTTER_MM}mm`,
          right: `${GUTTER_MM}mm`,
          top: `${PAD_MM}mm`,
          bottom: `${PAD_MM}mm`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "1mm",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div className="label-name" style={clamp(2.6, 700)}>
          {datum.name}
        </div>
        {datum.code !== "" && (
          <div className="label-code" style={clamp(2.3, 400)}>
            {datum.code}
          </div>
        )}
      </div>
    </div>
  );
}

/** The stickers, one per page. */
export function LabelSheet({
  labels,
  preview = false,
}: {
  labels: readonly LabelDatum[];
  /** Outline each sticker and space them out, for the dialog. */
  preview?: boolean;
}) {
  const qr = useQrCodes(labels.map((l) => l.barcode));

  return (
    <div
      className="label-print-root"
      style={
        preview
          ? { display: "flex", flexWrap: "wrap", gap: 12 }
          : { margin: 0, padding: 0 }
      }
    >
      <style>{`${LABEL_PAGE_RULE}\n${QR_SVG_RULE}`}</style>
      {labels.map((datum, i) => (
        <Label
          key={datum.serial}
          datum={datum}
          qrSvg={qr[datum.barcode]}
          last={i === labels.length - 1}
          preview={preview}
        />
      ))}
    </div>
  );
}

/**
 * What the dialog says about a serial it does not like.
 *
 * One sentence per fault, because the remedies are different: an unencodable
 * serial is a data problem somebody has to go and fix on the unit, whereas an
 * `I` in a serial is a typo at QC.
 */
function useFaultText() {
  const { t } = useTranslation();
  return (fault: SerialFault): string => {
    switch (fault) {
      case "empty":
        return t("labels.faultEmpty", "has no serial to encode");
      case "unencodable":
        return t(
          "labels.faultUnencodable",
          "has characters no barcode can carry",
        );
      case "charset":
        return t(
          "labels.faultCharset",
          "has something other than capitals and digits",
        );
      case "confusable":
        return t(
          "labels.faultConfusable",
          "has an I or an O, which Apple never prints",
        );
    }
  };
}

/**
 * The serials this print run is unhappy about, worst first.
 *
 * Checked before the sheet is drawn rather than after it is printed, which is
 * the whole point: a sheet of stickers cannot be un-printed, and a roll of
 * thermal stock is a real cost. See `inspectStoredSerial`.
 */
function SerialWarnings({ labels }: { labels: readonly LabelDatum[] }) {
  const { t } = useTranslation();
  const faultText = useFaultText();
  // Errors first: they are the ones stopping the print, so they are the ones
  // the reader has to act on. A rank rather than a `? -1 : 1` comparator,
  // which is not antisymmetric and leaves the order down to the sort's
  // implementation.
  const rank = (level: "error" | "warning") => (level === "error" ? 0 : 1);
  const flagged = labels
    .map((l) => ({ serial: l.serial, issue: inspectStoredSerial(l.serial) }))
    .filter(
      (x): x is { serial: string; issue: SerialInspection } => x.issue !== null,
    )
    .sort((a, b) => rank(a.issue.level) - rank(b.issue.level));
  if (flagged.length === 0) return null;

  const blocking = flagged.some((x) => x.issue.level === "error");

  return (
    <Alert
      type={blocking ? "error" : "warning"}
      showIcon
      style={{ marginBottom: 12 }}
      title={
        blocking
          ? t(
              "labels.cannotPrintTitle",
              "{{count}} of these cannot be printed",
              {
                count: flagged.filter((x) => x.issue.level === "error").length,
              },
            )
          : t("labels.checkTitle", "{{count}} serial(s) look wrong", {
              count: flagged.length,
            })
      }
      description={
        <Flex vertical gap={4} style={{ marginTop: 4 }}>
          {flagged.slice(0, 8).map((x) => (
            <Flex key={x.serial} align="center" gap={8} wrap>
              <Tag
                color={x.issue.level === "error" ? "error" : "warning"}
                style={{ fontFamily: "monospace", marginInlineEnd: 0 }}
              >
                {x.serial === ""
                  ? t("labels.blankSerial", "(blank)")
                  : x.serial}
              </Tag>
              <Typography.Text type="secondary">
                {faultText(x.issue.fault)}
              </Typography.Text>
            </Flex>
          ))}
          {flagged.length > 8 && (
            <Typography.Text type="secondary">
              {t("labels.andMore", "…and {{count}} more", {
                count: flagged.length - 8,
              })}
            </Typography.Text>
          )}
          <Typography.Text type="secondary">
            {blocking
              ? t(
                  "labels.cannotPrintBody",
                  "Correct the serial on the unit and come back — a sticker whose code does not match the text under it is worse than no sticker.",
                )
              : t(
                  "labels.checkBody",
                  "These will print and scan back fine. Worth a second look at the unit before the sticker goes on it.",
                )}
          </Typography.Text>
        </Flex>
      }
    />
  );
}

/**
 * The print dialog — the checks, a preview at true size, and a button that
 * fires the browser's own printer.
 *
 * Modelled on `InvoiceModal`: the stickers are mounted inside the modal and
 * global.css hides everything else, rather than opening a second window that a
 * pop-up blocker would eat. Exactly one print root may be mounted at a time,
 * which is why this is a modal and not an inline panel.
 */
export function PrintLabelsModal({
  open,
  labels,
  onClose,
}: {
  open: boolean;
  labels: readonly LabelDatum[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  /**
   * A serial with nothing printable in it stops the whole run, rather than
   * being quietly dropped: skipping it would print 35 stickers where 36 were
   * asked for, and the unit with no label would be found by somebody looking
   * for it on a shelf.
   */
  const blocked = labels.some((l) => !isPrintableSerial(l.serial));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="min(640px, calc(100vw - 32px))"
      title={t("labels.title", "Print labels — {{count}} serial(s)", {
        count: labels.length,
      })}
      classNames={{ footer: "no-print", header: "no-print" }}
      footer={[
        <Button key="close" onClick={onClose}>
          {t("labels.close", "Close")}
        </Button>,
        <Button
          key="print"
          type="primary"
          icon={<PrinterOutlined />}
          disabled={labels.length === 0 || blocked}
          onClick={() => {
            if (labels.length === 0) {
              message.warning(
                t("labels.nothingSelected", "Nothing selected to print."),
              );
              return;
            }
            if (blocked) {
              message.error(
                t(
                  "labels.blockedToast",
                  "Some of these have no serial that can be encoded. Fix them first.",
                ),
              );
              return;
            }
            window.print();
          }}
        >
          {t("labels.print", "Print")}
        </Button>,
      ]}
    >
      <div className="no-print">
        <SerialWarnings labels={labels} />
        <Typography.Paragraph type="secondary">
          {t(
            "labels.summary",
            "{{count}} label(s), one 50 × 30 mm sticker each. Print at 100% scale with no margins.",
            { count: labels.length },
          )}
        </Typography.Paragraph>
      </div>
      <div
        className="no-print"
        style={{
          maxHeight: "60vh",
          overflowY: "auto",
          background: "#f0f0f0",
          padding: 12,
        }}
      >
        <LabelSheet labels={labels} preview />
      </div>
      {/* The copy that prints: no outline, no spacing between stickers. */}
      <div className="label-print-only">
        <LabelSheet labels={labels} />
      </div>
    </Modal>
  );
}
