/**
 * Printable serial labels — on a sheet of A4, or one at a time off a thermal
 * roll.
 *
 * The label carries a barcode of the **serial**, not of the SKU: two units of
 * one model are the same SKU and a scan has to tell them apart, which is the
 * whole reason this shop is built around serials at all. Since 2026-08-28 that
 * serial carries its supplier's two-letter origin code (`lib/serialScan.ts`),
 * so what a sticker encodes is what intake really stored.
 *
 * Layout follows the owner's sketch (2026-08-24): the barcode at the left with
 * the serial printed beneath it, and the product code beside it on two lines.
 * The serial is printed as text as well as encoded, because a sticker that
 * will not scan — creased, smudged, peeled — still has to be usable by a
 * person typing it in.
 *
 * ## A square QR (owner decision 2026-08-28)
 *
 * The sticker carries a QR, and briefly did not: the scanner rules of the same
 * day open with *"Set Code 128 constraint"*, which was over-read here as a
 * statement about what the shop PRINTS. It is not — it is about the supplier's
 * barcode on the way in. The shop reads its own stickers with its own phones,
 * and a QR is both what they read and what survives a sticker's real life on a
 * second-hand laptop: creased, peeling, half under a thumb. A QR carries error
 * correction; a row of bars carries none.
 *
 * Code 128 is still selectable for a desk with a 1-D handheld on it —
 * `lib/code128.ts` draws it — but it is a choice, not the default.
 *
 * ## What may be printed at all
 *
 * Every serial is inspected before the dialog will print it
 * (`inspectStoredSerial`). An empty or unencodable one is refused outright:
 * there is nothing to draw, and a sticker whose code says something other than
 * the text under it is worse than no sticker. A serial that merely looks wrong
 * — an `I` where a `1` belongs, a length nothing Apple prints — is named and
 * printed anyway. See that function for why the two get different answers.
 *
 * ## Page setup (owner ask 2026-08-28)
 *
 * Two modes, because they are two different printers: a **sheet** of stickers
 * tiled onto paper the shop buys (A4, F4, Letter…), or a **roll**, where the
 * label IS the page and the printer feeds exactly one sticker's worth of
 * stock. `lib/labelPaper.ts` holds the geometry and works out how many fit
 * rather than taking a column count on trust.
 *
 * Printing reuses the visibility switch in global.css rather than opening a
 * second window, the same mechanism `Invoice` uses. The one addition is a
 * *named* page: the invoice's `@page` sets a 12mm margin, and sticker stock
 * needs zero, so `page: label-sheet` keeps the two from overwriting each
 * other. Its SIZE is now a per-print decision, so it is emitted from here —
 * see `pageRule`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Flex,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Tag,
  Typography,
} from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import type { LabelDatum } from "../lib/labels.js";
import {
  code128Bars,
  code128Width,
  QUIET_ZONE_MODULES,
} from "../lib/code128.js";
import {
  inspectStoredSerial,
  isPrintableSerial,
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  type SerialFault,
  type SerialInspection,
} from "../lib/serialScan.js";
import {
  DEFAULT_SETUP,
  GAP_MAX_MM,
  LABEL_MAX_MM,
  LABEL_MIN_MM,
  MARGIN_MAX_MM,
  PAPERS,
  pageRule,
  readLabelSetup,
  tiling,
  writeLabelSetup,
  type LabelPageMode,
  type LabelSetup,
  type LabelSymbology,
  type LabelTiling,
} from "../lib/labelPaper.js";

export type { LabelDatum };

/**
 * A CSS millimetre, in CSS pixels. Fixed by the spec at 96dpi, so this is a
 * constant rather than something to measure: 25.4mm to the inch.
 */
const PX_PER_MM = 96 / 25.4;

/**
 * QR markup for each serial, keyed by serial.
 *
 * Generated in an effect because `qrcode` is async, and cached across renders
 * so that re-rendering a 36-label sheet does not re-encode 36 QR codes. SVG
 * rather than a PNG data URL: a sticker is read by a machine at 300dpi and a
 * rasterised QR at label size is exactly the kind of thing that scans on the
 * screen and fails on paper.
 *
 * Skipped entirely when the sheet is printing Code 128 — encoding thirty-six
 * QR codes nobody will look at is thirty-six promises resolved for nothing.
 */
function useQrCodes(
  serials: readonly string[],
  enabled: boolean,
): Record<string, string> {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const key = serials.join(" ");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const build = async () => {
      const entries = await Promise.all(
        // Only what can actually be encoded. `QRCode.toString("")` rejects,
        // and one rejection inside `Promise.all` takes the whole batch down —
        // so a single bad serial used to mean a sheet of thirty-six blank
        // squares rather than thirty-five good stickers and one refusal.
        serials.filter(isPrintableSerial).map(
          async (s) =>
            [
              s,
              await QRCode.toString(s, {
                type: "svg",
                // No quiet zone from the library: the label's own padding
                // provides it, and the default 4-module margin would shrink
                // the modules to the point a cheap imager misses them.
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
    // not re-encode everything — which is why `serials` itself is not a
    // dependency.
  }, [key, enabled]);

  return codes;
}

/**
 * One Code 128 symbol, drawn to fit a box.
 *
 * `preserveAspectRatio="none"` on purpose: the viewBox is in MODULES and the
 * SVG box is in millimetres, so letting the browser preserve the ratio would
 * letterbox a barcode that is meant to fill the width it was given. Bars have
 * no aspect ratio to preserve — only a minimum width, which is what the
 * caller's sizing is for.
 *
 * Drawn as `shape-rendering: crispEdges`. A bar landing on a fractional device
 * pixel is anti-aliased into a grey edge, and grey edges are what turn a
 * marginal print into an unreadable one.
 */
function Barcode({
  value,
  widthMm,
  heightMm,
}: {
  value: string;
  widthMm: number;
  heightMm: number;
}) {
  const bars = code128Bars(value);
  if (bars.length === 0) return null;
  const modules = code128Width(value) + QUIET_ZONE_MODULES * 2;

  return (
    <svg
      width={`${widthMm}mm`}
      height={`${heightMm}mm`}
      viewBox={`0 0 ${modules} 100`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {bars.map((b) => (
        <rect
          key={b.x}
          x={b.x + QUIET_ZONE_MODULES}
          y={0}
          width={b.width}
          height={100}
          fill="#000"
        />
      ))}
    </svg>
  );
}

/** One sticker. */
function Label({
  datum,
  qrSvg,
  geometry,
  symbology,
}: {
  datum: LabelDatum;
  qrSvg: string | undefined;
  geometry: LabelTiling;
  symbology: LabelSymbology;
}) {
  const { labelWidthMm, labelHeightMm } = geometry;
  // 2mm of padding all round keeps ink off the die-cut edge, where sticker
  // stock is never quite aligned with the printer.
  const padMm = 2;
  const innerH = labelHeightMm - padMm * 2;
  // Text scales with the sticker rather than sitting at a fixed 3.1mm, so a
  // 25mm thermal label does not print its product code over the barcode.
  const codeFontMm = Math.max(1.8, Math.min(3.1, labelHeightMm / 9.7));
  const serialFontMm = Math.max(1.6, Math.min(2.4, labelHeightMm / 14));

  /*
   * Code 128 is WIDE and short; a QR is square. They want different halves of
   * the sticker, so the layout follows the symbology rather than forcing the
   * bars into the square the QR used to sit in — a 13-character Code 128 is
   * about 250 modules, and squeezing that into 20mm puts each module below
   * what a 203dpi thermal head can lay down.
   */
  const bars = symbology === "CODE128";
  /*
   * The QR is square, and sized off the sticker's height so that the serial
   * still has a line under it: 20mm on the 50 × 30 stock the shop prints,
   * which is the proportion the owner has been looking at.
   *
   * The floor is what makes it survive the roll. `labelHeightMm - 10` is a
   * fine rule at 30mm and a bad one at 15 — `LABEL_MIN_MM` — where it asks
   * for a 5mm square. A 25-module QR at 5mm is 0.2mm per module, which is
   * under one dot on a 203dpi thermal head: it would print as a grey smudge
   * that no scanner reads. 8mm still fits above the serial on the shortest
   * label the setup allows.
   */
  const codeSideMm = Math.max(8, labelHeightMm - 10);
  const barsWidthMm = labelWidthMm - padMm * 2;
  const barsHeightMm = Math.max(6, innerH * 0.5);

  const encoded = (
    <Flex
      vertical
      align="center"
      style={{ flex: bars ? undefined : "0 0 auto" }}
    >
      {bars ? (
        <Barcode
          value={datum.barcode}
          widthMm={barsWidthMm}
          heightMm={barsHeightMm}
        />
      ) : (
        <div
          style={{ width: `${codeSideMm}mm`, height: `${codeSideMm}mm` }}
          aria-hidden="true"
          // Locally generated markup from `qrcode`, never user HTML.
          dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }}
        />
      )}
      <div
        style={{
          fontSize: `${serialFontMm}mm`,
          fontFamily: "monospace",
          lineHeight: 1.1,
          marginTop: "0.6mm",
          letterSpacing: "0.02em",
        }}
      >
        {/* The store barcode, matching what the code above encodes — a
            sticker whose text and whose symbol disagree is a sticker nobody
            can check by eye. `datum.serial` is Apple's and stays off the
            label; it is on the machine already. */}
        {datum.barcode}
      </div>
    </Flex>
  );

  const words = (
    <div
      style={{
        flex: bars ? "0 0 auto" : "1 1 auto",
        minWidth: 0,
        lineHeight: 1.15,
        textAlign: bars ? ("center" as const) : ("left" as const),
        width: bars ? "100%" : undefined,
      }}
    >
      <div style={{ fontSize: `${codeFontMm}mm`, fontWeight: 700 }}>
        {datum.line1}
      </div>
      {datum.line2 !== "" && (
        <div style={{ fontSize: `${codeFontMm}mm`, fontWeight: 700 }}>
          {datum.line2}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="label-cell"
      style={{
        width: `${labelWidthMm}mm`,
        height: `${labelHeightMm}mm`,
        display: "flex",
        // Bars run the full width with the text under them; a QR sits beside
        // the text, which is the layout the owner sketched.
        flexDirection: bars ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: bars ? "0.5mm" : "2mm",
        padding: `${padMm}mm`,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {bars ? (
        <>
          {words}
          {encoded}
        </>
      ) : (
        <>
          {encoded}
          {words}
        </>
      )}
    </div>
  );
}

/**
 * The sheet itself.
 *
 * Labels are laid out in a fixed grid rather than a wrapping flex row so that
 * every cell lands on the same millimetre on every page — a sticker sheet is
 * unforgiving about drift, and a wrap that reflows by a fraction prints the
 * last column half onto the gutter.
 *
 * Pages are split explicitly at `columns × rows` so the browser never chooses
 * a break for us in the middle of a row of stickers. On a roll that is one
 * label per page, which is the same code path with a tiling of 1 × 1.
 */
export function LabelSheet({
  labels,
  setup = DEFAULT_SETUP,
  preview = false,
}: {
  labels: readonly LabelDatum[];
  setup?: LabelSetup;
  /**
   * Draw each page as a whole sheet of paper on screen.
   *
   * Off when printing, where the paper supplies the page box and forcing a
   * 297mm minimum height would round its way onto a blank extra sheet.
   */
  preview?: boolean;
}) {
  const geometry = tiling(setup);
  const qr = useQrCodes(
    labels.map((l) => l.barcode),
    setup.symbology === "QR",
  );
  const pages: LabelDatum[][] = [];
  for (let i = 0; i < labels.length; i += geometry.perPage) {
    pages.push(labels.slice(i, i + geometry.perPage));
  }

  return (
    <div className="label-print-root">
      {/*
       * The paper size, injected rather than written in global.css, because it
       * is a per-print decision now. Later in the document than the
       * stylesheet, so it wins on order — which is the only lever `@page` has,
       * having no selector to be specific about.
       */}
      <style>{pageRule(setup)}</style>
      {pages.map((page, pageIndex) => (
        <div
          key={pageIndex}
          className="label-page"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${geometry.columns}, ${geometry.labelWidthMm}mm)`,
            gridAutoRows: `${geometry.labelHeightMm}mm`,
            gap: `${geometry.gapMm}mm`,
            justifyContent: "center",
            alignContent: "start",
            paddingTop: `${geometry.marginMm}mm`,
            breakAfter: pageIndex < pages.length - 1 ? "page" : "auto",
            // On screen the page is drawn at its true size, so the reader is
            // looking at the actual sheet rather than at a strip of it cropped
            // to whatever the dialog happened to be wide. `ScaledSheet` below
            // shrinks the whole thing to fit; see its docblock for why that
            // has to be a transform rather than a narrower box.
            ...(preview
              ? {
                  width: `${geometry.pageWidthMm}mm`,
                  height: `${geometry.pageHeightMm}mm`,
                  boxSizing: "border-box" as const,
                  background: "#fff",
                  marginBottom: pageIndex < pages.length - 1 ? "8mm" : 0,
                }
              : {}),
          }}
        >
          {page.map((datum) => (
            <Label
              key={datum.serial}
              datum={datum}
              qrSvg={qr[datum.barcode]}
              geometry={geometry}
              symbology={setup.symbology}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The sheet, shrunk to fit the box it is shown in.
 *
 * A preview of A4 is 210mm — 794 CSS pixels — and no dialog on a laptop is
 * that wide once its own padding is taken off. Until 2026-08-26 the sheet was
 * simply dropped into an `overflow: auto` box, and because the grid inside it
 * is `justify-content: center`, the overflow went to BOTH sides: the scrollbar
 * could reach the right-hand columns and could not reach the left-hand ones at
 * all. That is the "barcode on the left is cut off" the owner reported — the
 * first column of every sheet was unreachable, not missing.
 *
 * Centred overflow cannot be scrolled to, so the fix is not to allow the
 * overflow: it is to stop overflowing. The page keeps its true geometry —
 * every millimetre of it is load-bearing, since the die-cut positions on
 * sticker stock are absolute — and a `transform: scale` shrinks the drawn
 * result. A transform does not reflow, so nothing moves relative to anything
 * else and what is on screen is what will come out of the printer.
 *
 * The wrapper's height has to be set by hand for the same reason: a transform
 * leaves layout size untouched, so an unscaled 297mm page would still reserve
 * 297mm of scroll even when drawn at half that.
 */
function ScaledSheet({
  labels,
  setup,
}: {
  labels: readonly LabelDatum[];
  setup: LabelSetup;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  const pageWidthMm = tiling(setup).pageWidthMm;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width === 0) return;
      // Never magnified: a sheet that fits already is shown at 1:1, because
      // blowing a 50mm sticker up to 70mm would misrepresent what prints.
      const next = Math.min(1, width / (pageWidthMm * PX_PER_MM));
      setScale(next);
      setHeight((inner.current?.offsetHeight ?? 0) * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [labels.length, setup, pageWidthMm]);

  return (
    <div ref={box} style={{ width: "100%", overflow: "hidden" }}>
      <div style={{ height, position: "relative" }}>
        <div
          ref={inner}
          style={{
            transform: `scale(${scale})`,
            // Top LEFT, not top centre: the box is exactly as wide as the
            // scaled page, so there is nothing to centre within, and a centred
            // origin would push half the page back out of view — the very bug
            // this replaces.
            transformOrigin: "top left",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <LabelSheet labels={labels} setup={setup} preview />
        </div>
      </div>
    </div>
  );
}

/**
 * Page setup — the owner's ask of 2026-08-28.
 *
 * Sheet or roll first, because it is the one answer that changes what the rest
 * of the panel asks for: a roll has no paper size, no margin and no gap, since
 * the sticker is the page.
 */
function SetupControls({
  setup,
  onChange,
}: {
  setup: LabelSetup;
  onChange: (next: LabelSetup) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof LabelSetup>(key: K, value: LabelSetup[K]) =>
    onChange({ ...setup, [key]: value });
  const sheet = setup.mode === "SHEET";

  const field = (label: string, control: React.ReactNode) => (
    <Flex vertical gap={4}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      {control}
    </Flex>
  );

  return (
    <Flex gap={12} wrap align="flex-end" style={{ marginBottom: 12 }}>
      {field(
        t("labels.printOn", "Print on"),
        <Segmented<LabelPageMode>
          value={setup.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "SHEET", label: t("labels.sheet", "Sheet of paper") },
            { value: "ROLL", label: t("labels.roll", "Thermal roll") },
          ]}
        />,
      )}
      {sheet &&
        field(
          t("labels.paper", "Paper"),
          <Select
            value={setup.paperId}
            style={{ width: 210 }}
            aria-label={t("labels.paper", "Paper")}
            onChange={(v) => set("paperId", v)}
            options={PAPERS.map((p) => ({ value: p.id, label: p.label }))}
          />,
        )}
      {field(
        t("labels.labelWidth", "Label width (mm)"),
        <InputNumber
          value={setup.labelWidthMm}
          min={LABEL_MIN_MM}
          max={LABEL_MAX_MM}
          style={{ width: 96 }}
          aria-label={t("labels.labelWidth", "Label width (mm)")}
          onChange={(v) => set("labelWidthMm", v ?? DEFAULT_SETUP.labelWidthMm)}
        />,
      )}
      {field(
        t("labels.labelHeight", "Label height (mm)"),
        <InputNumber
          value={setup.labelHeightMm}
          min={LABEL_MIN_MM}
          max={LABEL_MAX_MM}
          style={{ width: 96 }}
          aria-label={t("labels.labelHeight", "Label height (mm)")}
          onChange={(v) =>
            set("labelHeightMm", v ?? DEFAULT_SETUP.labelHeightMm)
          }
        />,
      )}
      {sheet &&
        field(
          t("labels.gap", "Gap (mm)"),
          <InputNumber
            value={setup.gapMm}
            min={0}
            max={GAP_MAX_MM}
            style={{ width: 84 }}
            aria-label={t("labels.gap", "Gap (mm)")}
            onChange={(v) => set("gapMm", v ?? 0)}
          />,
        )}
      {sheet &&
        field(
          t("labels.margin", "Margin (mm)"),
          <InputNumber
            value={setup.marginMm}
            min={0}
            max={MARGIN_MAX_MM}
            style={{ width: 84 }}
            aria-label={t("labels.margin", "Margin (mm)")}
            onChange={(v) => set("marginMm", v ?? 0)}
          />,
        )}
      {field(
        // "Code", not "Barcode". The default is a QR, and a QR is not a
        // barcode — a label that names one of the two options is a label that
        // reads as wrong half the time it is looked at.
        t("labels.symbology", "Code"),
        <Segmented<LabelSymbology>
          value={setup.symbology}
          onChange={(v) => set("symbology", v)}
          options={[
            { value: "QR", label: t("labels.qr", "QR") },
            { value: "CODE128", label: t("labels.code128", "Code 128") },
          ]}
        />,
      )}
    </Flex>
  );
}

/**
 * What the dialog says about a serial it does not like.
 *
 * One sentence per fault, because the remedies are different: an unencodable
 * serial is a data problem somebody has to go and fix on the unit, whereas an
 * `I` in a serial is a typo at QC — and a length nothing Apple prints is
 * usually half a serial that was committed before the scanner finished.
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
      case "shape":
        // The rule the whole app now runs on: S and then ten to twelve. A
        // serial that fails it predates the 2026-09-01 correction, so the
        // sticker still prints — it just says the serial looks wrong.
        return t(
          "labels.faultShape",
          "is not an S followed by {{min}}–{{max}} characters",
          { min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
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
                  "These will print and scan back fine. Worth a second look at the machine before the sticker goes on it.",
                )}
          </Typography.Text>
        </Flex>
      }
    />
  );
}

/**
 * The print dialog — page setup, a preview of the result, and a button that
 * fires the browser's own printer.
 *
 * Modelled on `InvoiceModal`: the sheet is mounted inside the modal and
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
   * Read once on mount rather than on every render: `readLabelSetup` parses
   * JSON, and the setup is edited far more often than the component mounts.
   */
  const [setup, setSetup] = useState<LabelSetup>(readLabelSetup);
  const geometry = tiling(setup);
  const sheets = Math.ceil(labels.length / geometry.perPage);
  /**
   * A serial with nothing printable in it stops the whole run, rather than
   * being quietly dropped from the sheet.
   *
   * Skipping it silently would print 35 stickers where 36 were asked for, and
   * the one machine with no label would be discovered by somebody looking for
   * it on a shelf. Refusing names the machine while the person is still at the
   * screen that can fix it.
   */
  const blocked = labels.some((l) => !isPrintableSerial(l.serial));

  const change = (next: LabelSetup) => {
    setSetup(next);
    writeLabelSetup(next);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      // As wide as the viewport sensibly allows, so a 210mm page is drawn at
      // something close to 1:1 rather than shrunk to a thumbnail.
      // `ScaledSheet` copes with whatever it actually gets.
      width="min(960px, calc(100vw - 32px))"
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
        <SetupControls setup={setup} onChange={change} />
        <Typography.Paragraph type="secondary">
          {setup.mode === "ROLL"
            ? t(
                "labels.rollSummary",
                "{{count}} label(s), one per {{w}} × {{h}}mm sticker. Set the printer's paper size to match the sticker, and print at 100% scale.",
                {
                  count: labels.length,
                  w: geometry.labelWidthMm,
                  h: geometry.labelHeightMm,
                },
              )
            : t(
                "labels.sheetSummary",
                "{{count}} label(s) across {{sheets}} sheet(s), {{cols}} across and {{rows}} down at {{w}} × {{h}}mm. Print at 100% scale — “fit to page” will shrink every label off its backing.",
                {
                  count: labels.length,
                  sheets,
                  cols: geometry.columns,
                  rows: geometry.rows,
                  w: geometry.labelWidthMm,
                  h: geometry.labelHeightMm,
                },
              )}
        </Typography.Paragraph>
      </div>
      {/*
       * Scrolls DOWN through the pages and never sideways. Horizontal overflow
       * is the bug this replaces — see `ScaledSheet` — so the one axis that
       * must never appear here is `x`.
       */}
      <div
        className="no-print"
        style={{
          maxHeight: "60vh",
          overflowY: "auto",
          overflowX: "hidden",
          background: "#f0f0f0",
          padding: 12,
        }}
      >
        <ScaledSheet labels={labels} setup={setup} />
      </div>
      {/* The one that actually prints. Kept out of the scroller so the print
          stylesheet sees a sheet at its true size with no transform on it —
          a scaled preview would go to the printer scaled. */}
      <div className="label-print-only">
        <LabelSheet labels={labels} setup={setup} />
      </div>
    </Modal>
  );
}
