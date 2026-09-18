/**
 * A purchase order that is still being typed (owner ask 2026-09-15).
 *
 * > *"Add an auto-save mechanism and a save draft Invoice fallback for every
 * > step."*
 *
 * Two different safety nets, and the difference matters:
 *
 * - **Auto-save** is this module. The order form is a three-step wizard whose
 *   answers lived in React state until the last step, so a reload, a closed
 *   tab or a flat laptop lost all of it. Every keystroke is now mirrored into
 *   `localStorage`, on THIS device, and offered back when the form reopens.
 *   It is not a document: nobody else can see it, and it names no supplier
 *   the database has heard of.
 * - **Save draft** is a real `Po` with `status: "DRAFT"`. It has a code, it is
 *   on the Inbound list, another till can open it, and it is what "I will
 *   finish this after lunch" means. That one is the form's own button.
 *
 * So auto-save protects the ten seconds nobody would think to press a button
 * for, and the draft protects the afternoon.
 *
 * ## Why one key, not one per field
 *
 * A half-restored order is worse than none: a supplier with somebody else's
 * lines under it is an order that looks filled in and is wrong. The whole
 * wizard is one value, written and read as one.
 *
 * Pure: no React, no store, no `window` — the caller passes its own storage,
 * which is what lets `test/inboundDraft.test.ts` check the parsing without a
 * DOM. `hooks/usePersistentState.ts` is what wires it to a real one.
 */

/** Where auto-save lives. Versioned, so a shape change cannot half-restore. */
export const INBOUND_DRAFT_KEY = "nusantara.inbound.draft.v1";

/** One line of the order, exactly as the form's `Line` holds it. */
export interface InboundDraftLine {
  readonly skuId?: string;
  readonly qty: number;
  readonly unitCost?: number;
}

/** Everything the wizard knows, in one value. */
export interface InboundDraft {
  readonly step: number;
  readonly supplier?: string;
  readonly invoice: string;
  readonly noInvoice: boolean;
  /** `YYYY-MM-DD`, not a `Dayjs`: this has to survive `JSON.stringify`. */
  readonly date: string | null;
  readonly warehouseId: string;
  readonly method?: string;
  readonly paid?: number;
  readonly shippingFee?: number;
  readonly taxFee?: number;
  readonly discountMode: "RP" | "PCT";
  readonly discount?: number;
  readonly discountPct?: number;
  readonly lines: readonly InboundDraftLine[];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Read a stored draft back, or `undefined` for anything this build does not
 * recognise.
 *
 * Every field is checked rather than trusted. What is in `localStorage` was
 * written by whatever build the browser last ran, and a `qty` of `"3"` or a
 * `lines` of `null` would reach an `InputNumber` as a shape it cannot render —
 * a blank page where an order used to be, which is a worse failure than the
 * lost typing this exists to prevent.
 */
export function parseInboundDraft(stored: unknown): InboundDraft | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const d = stored as Record<string, unknown>;
  if (!Array.isArray(d.lines)) return undefined;
  const lines: InboundDraftLine[] = [];
  for (const raw of d.lines) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const l = raw as Record<string, unknown>;
    lines.push({
      ...(str(l.skuId) === undefined ? {} : { skuId: str(l.skuId)! }),
      qty: num(l.qty) ?? 1,
      ...(num(l.unitCost) === undefined ? {} : { unitCost: num(l.unitCost)! }),
    });
  }
  const step = num(d.step);
  const date = typeof d.date === "string" ? d.date : null;
  return {
    step: step === undefined ? 0 : Math.max(0, Math.min(2, Math.trunc(step))),
    ...(str(d.supplier) === undefined ? {} : { supplier: str(d.supplier)! }),
    invoice: typeof d.invoice === "string" ? d.invoice : "",
    noInvoice: d.noInvoice === true,
    date,
    warehouseId: typeof d.warehouseId === "string" ? d.warehouseId : "",
    ...(str(d.method) === undefined ? {} : { method: str(d.method)! }),
    ...(num(d.paid) === undefined ? {} : { paid: num(d.paid)! }),
    ...(num(d.shippingFee) === undefined
      ? {}
      : { shippingFee: num(d.shippingFee)! }),
    ...(num(d.taxFee) === undefined ? {} : { taxFee: num(d.taxFee)! }),
    discountMode: d.discountMode === "PCT" ? "PCT" : "RP",
    ...(num(d.discount) === undefined ? {} : { discount: num(d.discount)! }),
    ...(num(d.discountPct) === undefined
      ? {}
      : { discountPct: num(d.discountPct)! }),
    lines,
  };
}

/**
 * Has anybody actually typed anything?
 *
 * A form opened and abandoned writes a draft of its own defaults — today's
 * date, the shop's own warehouse, cash — and offering *"restore your unsaved
 * order"* for that is a banner that cries wolf until nobody reads it. The
 * date and the warehouse are therefore not evidence; everything a person had
 * to decide is.
 */
export function inboundDraftHasContent(draft: InboundDraft): boolean {
  return (
    (draft.supplier ?? "").trim() !== "" ||
    draft.invoice.trim() !== "" ||
    draft.noInvoice ||
    draft.paid !== undefined ||
    draft.shippingFee !== undefined ||
    draft.taxFee !== undefined ||
    draft.discount !== undefined ||
    draft.discountPct !== undefined ||
    draft.lines.some(
      (l) => l.skuId !== undefined || l.unitCost !== undefined || l.qty > 1,
    )
  );
}
