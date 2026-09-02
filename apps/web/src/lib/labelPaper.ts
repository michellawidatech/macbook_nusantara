/**
 * What the labels are printed ON (owner ask 2026-08-28).
 *
 * *"When printing label, make it so that user can choose the page setting
 * (give them 1 big page with a bunch of barcode: A4, F3, etc, or per label
 * (they can use thermal sticker, make them specify the label dimension))"*
 *
 * Two genuinely different machines, so two modes rather than one with a lot of
 * options:
 *
 * - **Sheet.** A page of paper with labels tiled across it. The paper is a
 *   size the shop buys — A4, F4, Letter — and how many labels fit is a
 *   consequence of that size and the sticker's, not a number anybody should
 *   have to work out. See `tiling`.
 * - **Roll.** A thermal printer, one label at a time, where the LABEL is the
 *   page: the printer has no paper wider than the sticker, so a 210mm page
 *   with a 50mm sticker in the corner would feed 210mm of blank stock per
 *   machine.
 *
 * ## Why the geometry is computed rather than asked for
 *
 * The previous shape of this was `{ columns, rows, labelWidthMm,
 * labelHeightMm }` — four numbers that can disagree. Four across at 50mm is
 * 200mm, which fits A4; four across at 60mm is 240mm, which does not, and
 * nothing in the type said so. Asking for the paper and the sticker and
 * working the rest out cannot be inconsistent, and it is also what somebody
 * holding a pack of stickers actually knows: the pack says 50 × 30, and the
 * printer has A4 in it.
 *
 * ## F4
 *
 * 215 × 330mm, and it is in this list because it is what Indonesian shops
 * actually print on. It is not in most page-size dropdowns, which is exactly
 * why it has to be in this one.
 *
 * Pure: no React, no DOM beyond the one guarded `localStorage` read, which
 * follows `lib/scanner.ts`'s pattern — Safari throws on it in private
 * browsing, and a print preference is not worth taking the app down for.
 */

/** One page of paper the shop might have in the printer. */
export interface PaperSize {
  readonly id: string;
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

/**
 * The papers offered, portrait dimensions.
 *
 * `size: <w> <h>` in `@page` takes millimetres directly, so these are the
 * numbers that reach the printer rather than a name it has to recognise —
 * which matters most for F4, whose name no browser knows.
 */
export const PAPERS: readonly PaperSize[] = [
  { id: "A4", label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297 },
  { id: "F4", label: "F4 / Folio (215 × 330 mm)", widthMm: 215, heightMm: 330 },
  { id: "LETTER", label: "Letter (216 × 279 mm)", widthMm: 216, heightMm: 279 },
  { id: "LEGAL", label: "Legal (216 × 356 mm)", widthMm: 216, heightMm: 356 },
  { id: "A5", label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210 },
] as const;

export function paperById(id: string): PaperSize {
  return PAPERS.find((p) => p.id === id) ?? PAPERS[0]!;
}

/** A sheet of stock, or a roll of one-at-a-time stickers. */
export type LabelPageMode = "SHEET" | "ROLL";

/**
 * Which code goes on the sticker.
 *
 * **A square QR, by owner decision (2026-08-28).** The Code 128 constraint in
 * the scanner rules is about what the shop reads on the way IN — the supplier's
 * own barcode on the box — and it was over-read here as a statement about what
 * the shop should PRINT. It is not: the sticker is read by the shop's own
 * phones, and a QR is what they read. It also survives what a sticker on a
 * second-hand laptop actually suffers — creasing, peeling, a thumb over half
 * of it — far better than bars, because a QR carries error correction and a
 * 1-D symbol carries none.
 *
 * Code 128 stays selectable for the desk with a 1-D handheld on it. It is a
 * choice now rather than the default.
 */
export type LabelSymbology = "CODE128" | "QR";

export interface LabelSetup {
  readonly mode: LabelPageMode;
  /** Which paper, in `SHEET` mode. Ignored on a roll. */
  readonly paperId: string;
  /** The unprintable edge every desktop printer keeps for its grippers. */
  readonly marginMm: number;
  readonly labelWidthMm: number;
  readonly labelHeightMm: number;
  /** Space between stickers on a sheet. Die-cut stock usually has none. */
  readonly gapMm: number;
  readonly symbology: LabelSymbology;
}

/**
 * The default is the sheet the shop was already printing: 50 × 30mm die-cut
 * stickers on A4, four across and nine down, which is what `DEFAULT_GEOMETRY`
 * hard-coded before this file existed. `tiling` now derives those two numbers
 * instead of taking them on trust.
 */
export const DEFAULT_SETUP: LabelSetup = {
  mode: "SHEET",
  paperId: "A4",
  marginMm: 5,
  labelWidthMm: 50,
  labelHeightMm: 30,
  gapMm: 0,
  symbology: "QR",
};

/** The bounds each number is clamped to. A printer has no use for a 0mm label. */
export const LABEL_MIN_MM = 15;
export const LABEL_MAX_MM = 210;
export const MARGIN_MAX_MM = 30;
export const GAP_MAX_MM = 20;

/** How the setup lays out on paper. Everything the sheet renderer needs. */
export interface LabelTiling {
  readonly columns: number;
  readonly rows: number;
  readonly perPage: number;
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly labelWidthMm: number;
  readonly labelHeightMm: number;
  readonly marginMm: number;
  readonly gapMm: number;
  /**
   * True when even ONE label does not fit the paper. The dialog says so rather
   * than printing a page with a sticker hanging off it — which is a wasted
   * sheet of sticker stock, not a wasted sheet of paper.
   */
  readonly overflows: boolean;
}

/**
 * How many labels fit, and how big the page is.
 *
 * The `+ gap` in the numerator is the trailing gap that the last column does
 * not need: four 50mm labels with 2mm between them span 206mm, not 208mm, and
 * a formula without the correction would say three fit where four do.
 */
export function tiling(setup: LabelSetup): LabelTiling {
  const {
    labelWidthMm,
    labelHeightMm,
    gapMm,
    marginMm,
    mode,
  } = setup;

  if (mode === "ROLL") {
    // On a roll the label IS the page. One per page, no margin, no gap: the
    // printer feeds exactly as much stock as the sticker is long.
    return {
      columns: 1,
      rows: 1,
      perPage: 1,
      pageWidthMm: labelWidthMm,
      pageHeightMm: labelHeightMm,
      labelWidthMm,
      labelHeightMm,
      marginMm: 0,
      gapMm: 0,
      overflows: false,
    };
  }

  const paper = paperById(setup.paperId);
  const usableW = paper.widthMm - marginMm * 2;
  const usableH = paper.heightMm - marginMm * 2;
  const columns = Math.floor((usableW + gapMm) / (labelWidthMm + gapMm));
  const rows = Math.floor((usableH + gapMm) / (labelHeightMm + gapMm));

  return {
    columns: Math.max(columns, 1),
    rows: Math.max(rows, 1),
    perPage: Math.max(columns, 1) * Math.max(rows, 1),
    pageWidthMm: paper.widthMm,
    pageHeightMm: paper.heightMm,
    labelWidthMm,
    labelHeightMm,
    marginMm,
    gapMm,
    overflows: columns < 1 || rows < 1,
  };
}

/**
 * The `@page` rule this setup needs, as CSS text.
 *
 * `@page` cannot be scoped to an element, so the label sheet claims the NAMED
 * page `label-sheet` (see global.css) and this overrides its size. Emitted
 * into a `<style>` in the modal rather than written into the stylesheet
 * because the size is now a per-print decision, and a stylesheet cannot hold
 * one.
 *
 * Millimetres rather than a paper name: `size: F4` is not a thing any browser
 * knows, and the whole reason F4 is in the list is that nobody else offers it.
 */
export function pageRule(setup: LabelSetup): string {
  const t = tiling(setup);
  return `@page label-sheet { size: ${t.pageWidthMm}mm ${t.pageHeightMm}mm; margin: 0; }`;
}

// ---------------------------------------------------------------------------
// Persistence
//
// localStorage rather than `AppSetting`, and deliberately: which printer is on
// this desk is a fact about the desk. The person at the counter with the
// thermal printer and the person in the back with the laser want different
// answers, and a shared setting would have them overwriting each other all
// day. See `lib/scanner.ts`, which stores its thresholds the same way and for
// the same reason.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "nusantara.labels";

function clamp(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fallback;
}

export function readLabelSetup(): LabelSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETUP;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETUP;
    const p = parsed as Partial<Record<keyof LabelSetup, unknown>>;
    return {
      mode: p.mode === "ROLL" ? "ROLL" : "SHEET",
      paperId: PAPERS.some((x) => x.id === p.paperId)
        ? (p.paperId as string)
        : DEFAULT_SETUP.paperId,
      marginMm: clamp(p.marginMm, DEFAULT_SETUP.marginMm, 0, MARGIN_MAX_MM),
      labelWidthMm: clamp(
        p.labelWidthMm,
        DEFAULT_SETUP.labelWidthMm,
        LABEL_MIN_MM,
        LABEL_MAX_MM,
      ),
      labelHeightMm: clamp(
        p.labelHeightMm,
        DEFAULT_SETUP.labelHeightMm,
        LABEL_MIN_MM,
        LABEL_MAX_MM,
      ),
      gapMm: clamp(p.gapMm, DEFAULT_SETUP.gapMm, 0, GAP_MAX_MM),
      symbology: p.symbology === "CODE128" ? "CODE128" : "QR",
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function writeLabelSetup(setup: LabelSetup): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // A preference that cannot be persisted still applies for this print.
  }
}
