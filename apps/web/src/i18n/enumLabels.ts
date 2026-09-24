/**
 * Every domain enum that reaches a screen, and the English label it prints.
 *
 * These maps used to live one per page, which is how `StockHistoryPage` came to
 * print a bare `TERSEDIA` in a `Tag` while `StockAdjustmentPage`, two files
 * away, already held both the label and the colour for that exact value. A
 * screen cannot forget a map it does not own.
 *
 * The English label doubles as the catalogue key — `catalogue.ts` explains the
 * English-source-string shape — so `labelOf(UNIT_STATUS, raw, t)` resolves
 * through `locales/id.ts` without anyone inventing a dotted key. A caller that
 * must NOT translate passes no `t` and gets the English back: the printed
 * faktur is a print template and is deliberately outside the language switch.
 */
import type { TFunction } from "./translate.js";
import { SALE_CHANNELS } from "../lib/channels.js";

export interface TagLabel {
  label: string;
  color: string;
}

/**
 * `Unit.status`. The colours are the ones `StockAdjustmentPage` chose; this is
 * that map, moved rather than rewritten.
 */
export const UNIT_STATUS: Record<string, TagLabel> = {
  // "Pending QC" rather than "In QC": a unit sitting here has not been looked
  // at yet, which is what the Stock In queue actually means.
  QC: { label: "Pending QC", color: "orange" },
  TERSEDIA: { label: "In stock", color: "green" },
  DIRESERVASI: { label: "Reserved", color: "gold" },
  TERJUAL: { label: "Sold", color: "blue" },
  RETUR_SUPPLIER: { label: "Returned to supplier", color: "default" },
  SERVIS: { label: "On service", color: "purple" },
  HILANG: { label: "Lost", color: "red" },
};

/**
 * `StockMove.type` — why a counted product's quantity moved (2026-09-19).
 * Worded as the units' timeline words the same doors.
 */
export const STOCK_MOVE: Record<string, string> = {
  MASUK: "Arrived on an invoice",
  MASUK_BATAL: "Arrival undone",
  TERJUAL: "Sold",
  RETUR_PELANGGAN: "Returned by customer",
  TUKAR_TAMBAH: "Taken in on a trade-in",
  OPNAME: "Stock count difference",
  KOREKSI: "Adjustment",
  RETUR_SUPPLIER: "Returned to supplier",
};

/** `UnitEvent.type` — what the lifecycle timeline calls each append-only row. */
export const UNIT_EVENT: Record<string, string> = {
  // Owner's wording: a unit that has just arrived has NOT been through QC yet,
  // so calling this "received into QC" claimed a step that had not happened.
  DITERIMA: "Pending to QC",
  QC_SELESAI: "QC passed — entered inventory",
  DICATAT: "Note",
  DIPINDAH: "Moved",
  DIRESERVASI: "Reserved",
  RESERVASI_BATAL: "Reservation cancelled",
  TERJUAL: "Sold",
  RETUR_PELANGGAN: "Returned by customer",
  RETUR_SUPPLIER: "Returned to supplier",
  OPNAME_HILANG: "Missing at opname",
  OPNAME_DITEMUKAN: "Found at opname",
  KOREKSI: "Adjustment",
  // Its own line rather than folding into "Adjustment": a timeline that says a
  // machine was adjusted does not tell the next person that somebody looked at
  // a QC decision and judged it wrong (2026-08-27).
  QC_DIBUKA: "QC reopened",
};

/** `Reservation.status`. */
/**
 * A hold's state — in BOTH vocabularies, because this codebase has two.
 *
 * `Reservation.status` in `schema.prisma` is `TERJADWAL | SELESAI | BATAL`;
 * the browser store's is `ACTIVE | DONE | CANCELLED`. One concept, two spellings,
 * and this map is the only place either becomes words a person reads — so it
 * answers to both rather than making every caller translate first.
 *
 * That is not a nicety. The reservations screen rendered "Tidak dikenal" on
 * every status tag from the day it moved to the API (2026-09-05) until
 * 2026-09-08, because it fed the schema's spelling to a map that only knew the
 * store's, and `tagOf` correctly refuses to guess: an unmapped SCREAMING_CASE
 * token is "Unknown", never a colour borrowed from a status it might have been.
 * The map was right and the coverage was missing.
 *
 * A reservation that turned into a sale reads as "Bought", not "Done" — the
 * status the owner asked for, and the one that distinguishes a hold that
 * completed from a hold that merely stopped.
 */
export const RESERVATION_STATUS: Record<string, TagLabel> = {
  // The store's spelling.
  ACTIVE: { label: "On hold", color: "gold" },
  DONE: { label: "Bought", color: "green" },
  CANCELLED: { label: "Cancelled", color: "default" },
  // The schema's, which is what `Hold` carries and what the API returns.
  TERJADWAL: { label: "On hold", color: "gold" },
  SELESAI: { label: "Bought", color: "green" },
  BATAL: { label: "Cancelled", color: "default" },
};

/**
 * `Order.source` as a NOUN — the channel itself, for a column or a receipt
 * line that reads "Channel  Shopee".
 *
 * Built from `SALE_CHANNELS` rather than written out again, so adding a
 * marketplace is one edit rather than three that can disagree. Tokopedia and
 * TikTok arriving on 2026-08-26 is what made that worth doing.
 */
export const ORDER_SOURCE: Record<string, string> = Object.fromEntries(
  SALE_CHANNELS.map((c) => [c.value, c.label]),
);

/**
 * The same values as a PHRASE, for the middle of a sentence: the lifecycle
 * timeline says "Sold on Shopee", which the noun map above cannot produce
 * without reading as "Sold Shopee". Two senses of one enum, which is exactly
 * the case `catalogue.ts` says to keep apart.
 */
export const ORDER_SOURCE_PHRASE: Record<string, string> = Object.fromEntries(
  SALE_CHANNELS.map((c) => [c.value, c.phrase]),
);

/**
 * A value the maps above do not know.
 *
 * Enum-ish values are SCREAMING_CASE by convention across this codebase, which
 * makes an unmapped one cheap to recognise — and worth recognising, because the
 * two failure modes deserve different copy. A value that is absent is "None",
 * what this app prints for an empty cell (`fmtNone`). A value that is
 * PRESENT but unmapped is "Unknown": rendering "None" there would claim the unit
 * has no status when what actually happened is that the enum grew a member the
 * UI has not been taught yet. Anything else is already human text and is passed
 * through untouched.
 */
const ENUM_TOKEN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

function fallback(raw: string | null | undefined, t?: TFunction): string {
  if (raw == null || raw === "") return t ? t("common.none", "None") : "None";
  if (!ENUM_TOKEN.test(raw)) return raw;
  return t ? t("common.unknownValue", "Unknown") : "Unknown";
}

/** The label for a plain enum, translated when a `t` is supplied. */
export function labelOf(
  map: Record<string, string>,
  raw: string | null | undefined,
  t?: TFunction,
): string {
  const hit = raw == null ? undefined : map[raw];
  if (hit === undefined) return fallback(raw, t);
  return t ? t(hit) : hit;
}

/**
 * The label AND colour for an enum that renders as a `Tag`. An unmapped value
 * gets antd's neutral grey, so a status nobody has taught the UI about cannot
 * borrow the green that means "in stock".
 */
export function tagOf(
  map: Record<string, TagLabel>,
  raw: string | null | undefined,
  t?: TFunction,
): TagLabel {
  const hit = raw == null ? undefined : map[raw];
  if (hit === undefined) return { label: fallback(raw, t), color: "default" };
  return { label: t ? t(hit.label) : hit.label, color: hit.color };
}
